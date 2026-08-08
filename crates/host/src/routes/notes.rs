//! Note bodies and full-text search.

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use lumina_core::{NoteBody, SaveNoteRequest, SearchHit};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/notes/{id}", get(get_note).put(save_note))
        .route("/api/search", get(search))
}

async fn get_note(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<NoteBody>> {
    let owner = user.id();
    state
        .db(move |conn| {
            assert_readable(conn, id, owner)?;

            let (doc_json, plaintext, updated_at) = conn
                .query_row(
                    "SELECT doc_json, plaintext, updated_at FROM note_bodies WHERE node_id = ?1",
                    [id.to_string()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?
                .ok_or(HostError::NotFound("note"))?;

            Ok(Json(NoteBody {
                doc_json: serde_json::from_str(&doc_json).map_err(|e| {
                    HostError::Other(anyhow::anyhow!("stored note is not valid JSON: {e}"))
                })?,
                plaintext,
                updated_at: parse_ts(&updated_at)?,
            }))
        })
        .await
}

async fn save_note(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<SaveNoteRequest>,
) -> HostResult<Json<NoteBody>> {
    let owner = user.id();
    state
        .db(move |conn| {
            assert_owned(conn, id, owner)?;

            let current: String = conn
                .query_row(
                    "SELECT updated_at FROM note_bodies WHERE node_id = ?1",
                    [id.to_string()],
                    |r| r.get(0),
                )
                .optional()?
                .ok_or(HostError::NotFound("note"))?;

            // Optimistic concurrency. A client flushing a stale offline outbox
            // is told to reload rather than silently overwriting a newer edit.
            if let Some(base) = req.base_updated_at {
                if parse_ts(&current)? > base {
                    return Err(HostError::Conflict);
                }
            }

            let now = Utc::now();
            let doc_json = serde_json::to_string(&req.doc_json)
                .map_err(|e| HostError::BadRequest(format!("note document is not valid: {e}")))?;

            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE note_bodies SET doc_json = ?2, plaintext = ?3, updated_at = ?4
                  WHERE node_id = ?1",
                rusqlite::params![id.to_string(), doc_json, req.plaintext, now.to_rfc3339()],
            )?;
            tx.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                rusqlite::params![id.to_string(), now.to_rfc3339()],
            )?;
            tx.commit()?;

            Ok(Json(NoteBody {
                doc_json: req.doc_json,
                plaintext: req.plaintext,
                updated_at: now,
            }))
        })
        .await
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: String,
}

async fn search(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(query): Query<SearchQuery>,
) -> HostResult<Json<Vec<SearchHit>>> {
    let owner = user.id().to_string();
    state
        .db(move |conn| {
            let Some(match_expr) = to_fts_query(&query.q) else {
                return Ok(Json(Vec::new()));
            };

            // Match markers are control characters, not `<mark>` tags. The
            // snippet is student-written prose, so returning HTML would mean the
            // client had to render it as HTML — and a note containing `<script>`
            // would then execute in whoever searched for it, including every
            // student reading the shared class library.
            let mut stmt = conn.prepare(
                "SELECT s.node_id,
                        n.name,
                        snippet(note_search, 1, char(2), char(3), '…', 12)
                   FROM note_search s
                   JOIN nodes n ON n.id = s.node_id
                  WHERE note_search MATCH ?1
                    AND (n.owner_id = ?2 OR n.owner_id IS NULL)
                  ORDER BY rank
                  LIMIT 50",
            )?;

            let hits = stmt
                .query_map(rusqlite::params![match_expr, owner], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter_map(|(node_id, name, snippet)| {
                    Some(SearchHit {
                        node_id: node_id.parse().ok()?,
                        name,
                        snippet,
                    })
                })
                .collect();

            Ok(Json(hits))
        })
        .await
}

/// Turns whatever the student typed into a safe FTS5 prefix query.
///
/// Raw input cannot go into `MATCH`: characters like `"` and `*` are FTS5
/// operators and a stray one is a syntax error, not a zero-result search. Each
/// word is quoted (so the contents are literal) and given a prefix `*` so
/// results appear while typing.
fn to_fts_query(raw: &str) -> Option<String> {
    let terms: Vec<String> = raw
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        })
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\"*"))
        .collect();

    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" AND "))
    }
}

fn assert_readable(conn: &rusqlite::Connection, id: Uuid, owner: Uuid) -> HostResult<()> {
    let owner_id: Option<String> = conn
        .query_row(
            "SELECT owner_id FROM nodes WHERE id = ?1",
            [id.to_string()],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(HostError::NotFound("note"))?;

    match owner_id {
        None => Ok(()), // shared library
        Some(id) if id == owner.to_string() => Ok(()),
        Some(_) => Err(HostError::Forbidden),
    }
}

fn assert_owned(conn: &rusqlite::Connection, id: Uuid, owner: Uuid) -> HostResult<()> {
    let owner_id: Option<String> = conn
        .query_row(
            "SELECT owner_id FROM nodes WHERE id = ?1",
            [id.to_string()],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(HostError::NotFound("note"))?;

    if owner_id.as_deref() == Some(owner.to_string().as_str()) {
        Ok(())
    } else {
        Err(HostError::Forbidden)
    }
}

fn parse_ts(raw: &str) -> HostResult<DateTime<Utc>> {
    raw.parse()
        .map_err(|e| HostError::Other(anyhow::anyhow!("bad timestamp in database: {e}")))
}

#[cfg(test)]
mod tests {
    use super::to_fts_query;

    #[test]
    fn builds_a_prefix_query_per_word() {
        assert_eq!(
            to_fts_query("light bends"),
            Some("\"light\"* AND \"bends\"*".into())
        );
    }

    #[test]
    fn strips_fts5_operators_instead_of_erroring() {
        // A bare `"` or `*` would be an FTS5 syntax error if passed through.
        assert_eq!(to_fts_query("\"optics*\""), Some("\"optics\"*".into()));
        assert_eq!(
            to_fts_query("a AND b"),
            Some("\"a\"* AND \"AND\"* AND \"b\"*".into())
        );
    }

    #[test]
    fn punctuation_only_input_searches_for_nothing() {
        assert_eq!(to_fts_query("   "), None);
        assert_eq!(to_fts_query("*** \"\""), None);
    }
}
