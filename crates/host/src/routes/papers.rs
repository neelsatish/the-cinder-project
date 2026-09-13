//! The paper creator's host side: finding official papers, pulling the chosen
//! one in, locating figures on its pages, and storing the result.
//!
//! Every route here is teacher-only. The AI provider is never reachable from a
//! student client, and a source document is fetched only after a teacher picks
//! one by hand — Cinder does not crawl search results.

use std::str::FromStr;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use cinder_ai::google::GoogleClient;
use cinder_core::{
    PaperCandidate, PaperFetchRequest, PaperFigure, PaperFiguresRequest, PaperSearchRequest,
    PaperSourceMode, QuestionPaper, SaveQuestionPaperRequest,
};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::routes::ai::{load_ai, record_ai_usage};
use crate::routes::classrooms::require_teacher_access;
use crate::routes::files::{store_material, UploadQuery};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/papers", get(list_papers))
        .route("/api/papers/search", post(search))
        .route("/api/papers/fetch", post(fetch_source))
        .route("/api/papers/figures", post(figures))
        .route(
            "/api/papers/{id}",
            get(get_paper).patch(update_paper).delete(delete_paper),
        )
}

/// Examination boards whose own sites may be fetched from. A question bank or
/// file-sharing mirror is not an official source and is not reachable here even
/// if the model suggests one.
const SOURCE_ALLOWLIST: &[&str] = &[
    "cambridgeinternational.org",
    "cbseacademic.nic.in",
    "cbse.gov.in",
    "cbse.nic.in",
    "cisce.org",
];

/// Matches the teacher app's own reference limit, so nothing is stored that the
/// client will then refuse to read.
const MAX_SOURCE_BYTES: usize = 25 * 1024 * 1024;
const MAX_FIGURE_PAGES: usize = 8;
const MAX_FIGURE_PAGE_CHARS: usize = 4 * 1024 * 1024;
const MAX_FIGURE_REQUEST_CHARS: usize = 12 * 1024 * 1024;
const MAX_SEARCH_QUERY_CHARS: usize = 400;

fn host_is_allowed(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    SOURCE_ALLOWLIST
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

/// Rejects anything that is not a plain HTTPS document on a board's own site.
/// This is the only place the host makes an outbound request to an address a
/// client supplied, so the checks live here rather than at the call site.
fn validate_source_url(raw: &str) -> HostResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw.trim())
        .map_err(|_| HostError::BadRequest("That is not a valid paper address.".into()))?;
    if url.scheme() != "https" {
        return Err(HostError::BadRequest(
            "Papers can only be downloaded over HTTPS.".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(HostError::BadRequest(
            "That paper address cannot contain credentials.".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| HostError::BadRequest("That paper address has no website.".into()))?;
    if cinder_core::is_local_network_host(host) {
        return Err(HostError::BadRequest(
            "That address points back at this network, not an examination board.".into(),
        ));
    }
    if !host_is_allowed(host) {
        return Err(HostError::BadRequest(format!(
            "Cinder only downloads papers from an examination board's own site ({}).",
            SOURCE_ALLOWLIST.join(", ")
        )));
    }
    Ok(url)
}

async fn google_client(state: &AppState) -> HostResult<(GoogleClient, String)> {
    let secret = state.ai_key_secret;
    let stored = state.db(move |conn| load_ai(conn, &secret)).await?;
    let key = stored.google_key.ok_or(HostError::AiUnavailable)?;
    let model = stored.google_model;
    Ok((GoogleClient::new(&key, &model), model))
}

async fn search(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(req): Json<PaperSearchRequest>,
) -> HostResult<Json<Vec<PaperCandidate>>> {
    user.require_teacher()?;
    if req.query.chars().count() > MAX_SEARCH_QUERY_CHARS {
        return Err(HostError::BadRequest("That search is too long.".into()));
    }
    let (client, model) = google_client(&state).await?;
    let (candidates, usage) = client
        .search_papers(&req.query)
        .await
        .map_err(|e| HostError::BadRequest(format!("{e:#}")))?;
    let teacher_id = user.id();
    state
        .db(move |conn| record_ai_usage(conn, teacher_id, "paper_search", "google", &model, usage))
        .await?;

    // A suggestion pointing somewhere Cinder will refuse to download is worse
    // than no suggestion, so it is dropped before the teacher sees it.
    Ok(Json(
        candidates
            .into_iter()
            .filter(|candidate| validate_source_url(&candidate.url).is_ok())
            .collect(),
    ))
}

async fn fetch_source(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(req): Json<PaperFetchRequest>,
) -> HostResult<Json<cinder_core::Node>> {
    user.require_teacher()?;
    let url = validate_source_url(&req.url)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        // Every hop is re-checked: a board page that redirects off its own site
        // must not become a way to reach an arbitrary address.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.stop();
            }
            match attempt.url().host_str() {
                Some(host) if host_is_allowed(host) => attempt.follow(),
                _ => attempt.stop(),
            }
        }))
        .build()
        .map_err(|e| HostError::Other(anyhow::anyhow!("building an http client: {e}")))?;

    let mut response =
        client.get(url.clone()).send().await.map_err(|e| {
            HostError::BadRequest(format!("That paper could not be downloaded: {e}"))
        })?;
    if !response.status().is_success() {
        return Err(HostError::BadRequest(format!(
            "The board's site returned {}.",
            response.status()
        )));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !content_type.starts_with("application/pdf") {
        return Err(HostError::BadRequest(
            "That link is not a PDF. Open it on the board's site and pick the paper itself.".into(),
        ));
    }

    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| HostError::BadRequest(format!("The download was interrupted: {e}")))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_SOURCE_BYTES {
            return Err(HostError::BadRequest(format!(
                "That paper is larger than the {} MB limit.",
                MAX_SOURCE_BYTES / 1_048_576
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !bytes.starts_with(b"%PDF") {
        return Err(HostError::BadRequest(
            "That download was not a PDF file.".into(),
        ));
    }

    let name = url
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).next_back())
        .filter(|segment| segment.to_ascii_lowercase().ends_with(".pdf"))
        .unwrap_or("past-paper.pdf")
        .to_owned();

    // The teacher's own tree, not the class library: a downloaded past paper is
    // a source for writing questions, and students should not receive it just
    // because it was used as a reference.
    store_material(
        &state,
        &user,
        UploadQuery {
            parent_id: None,
            classroom_id: None,
            shared: false,
        },
        name,
        bytes,
    )
    .await
}

async fn figures(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(req): Json<PaperFiguresRequest>,
) -> HostResult<Json<Vec<PaperFigure>>> {
    user.require_teacher()?;
    if req.pages.is_empty() {
        return Err(HostError::BadRequest(
            "Choose at least one page to look at.".into(),
        ));
    }
    if req.pages.len() > MAX_FIGURE_PAGES {
        return Err(HostError::BadRequest(format!(
            "Look at up to {MAX_FIGURE_PAGES} pages at a time."
        )));
    }
    let total: usize = req.pages.iter().map(|page| page.jpeg_base64.len()).sum();
    if total > MAX_FIGURE_REQUEST_CHARS
        || req
            .pages
            .iter()
            .any(|page| page.jpeg_base64.len() > MAX_FIGURE_PAGE_CHARS)
    {
        return Err(HostError::BadRequest(
            "Those page images are too large. Render them at a lower zoom.".into(),
        ));
    }

    let (client, model) = google_client(&state).await?;
    let (figures, usage) = client
        .find_figures(&req.pages)
        .await
        .map_err(|e| HostError::BadRequest(format!("{e:#}")))?;
    let teacher_id = user.id();
    state
        .db(move |conn| {
            record_ai_usage(
                conn,
                teacher_id,
                "figure_detection",
                "google",
                &model,
                usage,
            )
        })
        .await?;
    Ok(Json(figures))
}

fn row_to_paper(row: &rusqlite::Row<'_>) -> rusqlite::Result<QuestionPaper> {
    let json = |index: usize| -> rusqlite::Result<serde_json::Value> {
        let raw: String = row.get(index)?;
        Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
    };
    let parse_uuid = |value: String| Uuid::parse_str(&value).unwrap_or(Uuid::nil());
    let timestamp = |index: usize| -> rusqlite::Result<DateTime<Utc>> {
        let raw: String = row.get(index)?;
        Ok(DateTime::parse_from_rfc3339(&raw)
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()))
    };
    Ok(QuestionPaper {
        id: parse_uuid(row.get(0)?),
        owner_id: parse_uuid(row.get(1)?),
        classroom_id: row.get::<_, Option<String>>(2)?.map(parse_uuid),
        title: row.get(3)?,
        subject: row.get(4)?,
        board: row.get(5)?,
        syllabus_code: row.get(6)?,
        difficulty: row.get::<_, i64>(7)?.clamp(1, 5) as u8,
        source_mode: PaperSourceMode::from_str(&row.get::<_, String>(8)?)
            .unwrap_or(PaperSourceMode::Adapt),
        rights_confirmed: row.get::<_, i64>(9)? != 0,
        spec: json(10)?,
        scheme: json(11)?,
        sources: json(12)?,
        advanced: json(13)?,
        created_at: timestamp(14)?,
        updated_at: timestamp(15)?,
    })
}

const PAPER_COLUMNS: &str = "id, owner_id, classroom_id, title, subject, board, syllabus_code, \
     difficulty, source_mode, rights_confirmed, spec_json, scheme_json, sources_json, \
     advanced_json, created_at, updated_at";

async fn list_papers(
    State(state): State<AppState>,
    user: CurrentUser,
) -> HostResult<Json<Vec<QuestionPaper>>> {
    user.require_teacher()?;
    let owner = user.id();
    state
        .db(move |conn| {
            let mut statement = conn.prepare(&format!(
                "SELECT {PAPER_COLUMNS} FROM question_papers WHERE owner_id = ?1
                 ORDER BY updated_at DESC"
            ))?;
            let rows = statement.query_map([owner.to_string()], row_to_paper)?;
            Ok(Json(rows.collect::<Result<Vec<_>, _>>()?))
        })
        .await
}

async fn get_paper(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<QuestionPaper>> {
    user.require_teacher()?;
    let owner = user.id();
    state
        .db(move |conn| {
            conn.query_row(
                &format!(
                    "SELECT {PAPER_COLUMNS} FROM question_papers WHERE id = ?1 AND owner_id = ?2"
                ),
                rusqlite::params![id.to_string(), owner.to_string()],
                row_to_paper,
            )
            .optional()?
            .map(Json)
            .ok_or(HostError::NotFound("question paper"))
        })
        .await
}

fn validate(req: &SaveQuestionPaperRequest) -> HostResult<()> {
    if req.title.trim().is_empty() {
        return Err(HostError::BadRequest("Give the paper a title.".into()));
    }
    if req.source_mode.needs_rights_confirmation() && !req.rights_confirmed {
        return Err(HostError::BadRequest(
            "Confirm your school may reproduce this material before saving exact questions or \
             whole pages."
                .into(),
        ));
    }
    Ok(())
}

/// Upsert, because the teacher app autosaves a paper it already has an id for.
/// A conflicting id owned by another teacher fails the `DO UPDATE` guard and
/// reports as not found, so ids cannot be used to reach somebody else's work.
async fn update_paper(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<SaveQuestionPaperRequest>,
) -> HostResult<Json<QuestionPaper>> {
    user.require_teacher()?;
    validate(&req)?;
    let owner = user.id();

    if let Some(classroom_id) = req.classroom_id {
        state
            .db(move |conn| require_teacher_access(conn, classroom_id, owner))
            .await?;
    }

    state
        .db(move |conn| {
            let changed = conn.execute(
                "INSERT INTO question_papers
                    (id, owner_id, classroom_id, title, subject, board, syllabus_code, difficulty,
                     source_mode, rights_confirmed, spec_json, scheme_json, sources_json,
                     advanced_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
                 ON CONFLICT(id) DO UPDATE SET
                    classroom_id = excluded.classroom_id, title = excluded.title,
                    subject = excluded.subject, board = excluded.board,
                    syllabus_code = excluded.syllabus_code, difficulty = excluded.difficulty,
                    source_mode = excluded.source_mode,
                    rights_confirmed = excluded.rights_confirmed,
                    spec_json = excluded.spec_json, scheme_json = excluded.scheme_json,
                    sources_json = excluded.sources_json, advanced_json = excluded.advanced_json,
                    updated_at = excluded.updated_at
                 WHERE question_papers.owner_id = ?2",
                rusqlite::params![
                    id.to_string(),
                    owner.to_string(),
                    req.classroom_id.map(|value| value.to_string()),
                    req.title.trim(),
                    req.subject.trim(),
                    req.board.trim(),
                    req.syllabus_code.trim(),
                    i64::from(req.difficulty.clamp(1, 5)),
                    req.source_mode.as_str(),
                    i64::from(req.rights_confirmed),
                    req.spec.to_string(),
                    req.scheme.to_string(),
                    req.sources.to_string(),
                    req.advanced.to_string(),
                    Utc::now().to_rfc3339(),
                ],
            )?;
            if changed == 0 {
                return Err(HostError::NotFound("question paper"));
            }
            Ok(())
        })
        .await?;

    get_paper(State(state), user, Path(id)).await
}

async fn delete_paper(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<axum::http::StatusCode> {
    user.require_teacher()?;
    let owner = user.id();
    state
        .db(move |conn| {
            let changed = conn.execute(
                "DELETE FROM question_papers WHERE id = ?1 AND owner_id = ?2",
                rusqlite::params![id.to_string(), owner.to_string()],
            )?;
            if changed == 0 {
                return Err(HostError::NotFound("question paper"));
            }
            Ok(axum::http::StatusCode::NO_CONTENT)
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_board_sites_can_be_downloaded_from() {
        for address in [
            "https://www.cambridgeinternational.org/Images/0620_s23_qp_42.pdf",
            "https://cbseacademic.nic.in/web_material/SQP/sqp.pdf",
            "https://cisce.org/paper.pdf",
        ] {
            assert!(
                validate_source_url(address).is_ok(),
                "expected {address} to be accepted"
            );
        }

        for address in [
            // Not a board site.
            "https://papers.example.com/0620_s23_qp_42.pdf",
            // Allowlisted name used as a prefix of somebody else's domain.
            "https://cisce.org.attacker.example/paper.pdf",
            // Plaintext, credentials, and addresses that point back inside the school.
            "http://www.cambridgeinternational.org/paper.pdf",
            "https://user:secret@cisce.org/paper.pdf",
            "https://localhost/paper.pdf",
            "https://127.0.0.1/paper.pdf",
            "file:///etc/passwd",
        ] {
            assert!(
                validate_source_url(address).is_err(),
                "expected {address} to be rejected"
            );
        }
    }

    #[test]
    fn subdomains_of_a_board_are_still_the_board() {
        assert!(host_is_allowed("www.cambridgeinternational.org"));
        assert!(host_is_allowed("CBSEACADEMIC.NIC.IN"));
        assert!(!host_is_allowed("cambridgeinternational.org.evil.test"));
        assert!(!host_is_allowed("notcisce.org"));
    }

    #[test]
    fn reusing_a_source_verbatim_needs_a_confirmation() {
        let paper = |mode: PaperSourceMode, confirmed: bool| SaveQuestionPaperRequest {
            classroom_id: None,
            title: "Paper 4".into(),
            subject: "Physics".into(),
            board: "CIE".into(),
            syllabus_code: "0625".into(),
            difficulty: 3,
            source_mode: mode,
            rights_confirmed: confirmed,
            spec: serde_json::json!({}),
            scheme: serde_json::json!({}),
            sources: serde_json::json!([]),
            advanced: serde_json::json!({}),
        };
        assert!(validate(&paper(PaperSourceMode::Adapt, false)).is_ok());
        assert!(validate(&paper(PaperSourceMode::Excerpt, false)).is_err());
        assert!(validate(&paper(PaperSourceMode::Excerpt, true)).is_ok());
        assert!(validate(&paper(PaperSourceMode::FullPage, false)).is_err());
    }
}
