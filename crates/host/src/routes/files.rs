//! Uploading and serving study material.
//!
//! Blobs are content-addressed on disk (`files/<sha[0..2]>/<sha>`), so the same
//! PDF handed to thirty students costs one copy on the teacher's machine — which
//! matters when that machine is a recovered office PC with a small disk.

use std::path::PathBuf;

use axum::body::Body;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use cinder_core::{FileMeta, Node, NodeKind, ALLOWED_UPLOAD_MIMES, MAX_UPLOAD_BYTES};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::routes::classrooms::teacher_can_access;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/files", post(upload))
        .route("/api/files/{id}", get(download))
}

#[derive(Debug, Clone, Copy, Deserialize)]
struct UploadQuery {
    parent_id: Option<Uuid>,
    classroom_id: Option<Uuid>,
    /// Teachers only: put this in the shared class library instead of the
    /// uploader's own tree.
    #[serde(default)]
    shared: bool,
}

async fn upload(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> HostResult<Json<Node>> {
    if query.shared {
        user.require_teacher()?;
    }

    let mut original_name = String::new();
    let mut bytes: Vec<u8> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| HostError::BadRequest(format!("could not read the upload: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        original_name = field.file_name().unwrap_or("material").to_owned();
        bytes = field
            .bytes()
            .await
            .map_err(|e| HostError::BadRequest(format!("could not read the file: {e}")))?
            .to_vec();
        break;
    }

    if bytes.is_empty() {
        return Err(HostError::BadRequest("That file is empty.".into()));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(HostError::BadRequest(format!(
            "That file is {} MB. The limit is {} MB.",
            bytes.len() / 1_048_576,
            MAX_UPLOAD_BYTES / 1_048_576
        )));
    }

    // Sniff the actual bytes. A filename is a claim by the uploader, and on a
    // shared lab machine that is not something to base a decision on.
    let mime = sniff(&bytes).ok_or_else(|| {
        HostError::BadRequest("Only PDFs and images (PNG, JPEG, WebP, GIF) can be added.".into())
    })?;
    debug_assert!(ALLOWED_UPLOAD_MIMES.contains(&mime));

    let authorization_user = user.clone();
    state
        .db(move |conn| authorize_upload(conn, &authorization_user, query))
        .await?;

    let digest = hex::encode(Sha256::digest(&bytes));
    let path = blob_path(&state.files_dir, &digest);
    let created_blob = !path.exists();
    if created_blob {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| HostError::Other(anyhow::anyhow!("creating blob directory: {e}")))?;
        }
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|e| HostError::Other(anyhow::anyhow!("writing blob: {e}")))?;
    }

    let owner = user.id();
    let size = bytes.len() as i64;
    let display_name = tidy_name(&original_name);
    let stored_digest = digest.clone();

    let result = state
        .db(move |conn| {
            authorize_upload(conn, &user, query)?;

            let id = Uuid::new_v4();
            let now = Utc::now();
            let owner_id = if query.shared {
                None
            } else {
                Some(owner.to_string())
            };

            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO nodes
                    (id, owner_id, parent_id, classroom_id, name, kind, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'pdf', ?6, ?7, ?7)",
                rusqlite::params![
                    id.to_string(),
                    owner_id,
                    query.parent_id.map(|p| p.to_string()),
                    query.classroom_id.map(|value| value.to_string()),
                    display_name,
                    cinder_core::POSITION_STEP,
                    now.to_rfc3339(),
                ],
            )?;
            tx.execute(
                "INSERT INTO files (node_id, sha256, orig_name, bytes, mime, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    id.to_string(),
                    stored_digest,
                    original_name,
                    size,
                    mime,
                    now.to_rfc3339()
                ],
            )?;
            tx.commit()?;

            Ok(Json(Node {
                id,
                owner_id: if query.shared { None } else { Some(owner) },
                parent_id: query.parent_id,
                classroom_id: query.classroom_id,
                name: display_name,
                // Images are stored as `pdf` kind too — the tree only needs to
                // know "this is a file"; the viewer branches on the mime type.
                kind: NodeKind::Pdf,
                position: cinder_core::POSITION_STEP,
                icon: None,
                created_at: now,
                updated_at: now,
            }))
        })
        .await;

    if result.is_err() && created_blob {
        cleanup_unreferenced_blob(&state, digest, &path).await;
    }

    result
}

fn authorize_upload(
    conn: &rusqlite::Connection,
    user: &CurrentUser,
    query: UploadQuery,
) -> HostResult<()> {
    let owner = user.id();
    if query.shared {
        user.require_teacher()?;
    }

    if let Some(classroom_id) = query.classroom_id {
        let allowed = if user.0.role.is_teacher() {
            teacher_can_access(conn, classroom_id, owner)?
        } else {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM classroom_enrolments
                  WHERE classroom_id = ?1 AND student_id = ?2)",
                rusqlite::params![classroom_id.to_string(), owner.to_string()],
                |row| row.get(0),
            )?
        };
        if !allowed {
            return Err(HostError::Forbidden);
        }
    }

    if let Some(parent_id) = query.parent_id {
        let parent: (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT kind, owner_id, classroom_id FROM nodes WHERE id = ?1",
                [parent_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or(HostError::NotFound("folder"))?;
        if parent.0 != "folder" {
            return Err(HostError::BadRequest(
                "Material can only go inside a folder.".into(),
            ));
        }
        let expected_owner = if query.shared {
            None
        } else {
            Some(owner.to_string())
        };
        if parent.1 != expected_owner || parent.2 != query.classroom_id.map(|id| id.to_string()) {
            return Err(HostError::Forbidden);
        }
    }

    Ok(())
}

async fn download(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> HostResult<Response> {
    let owner = user.id();
    let meta: (String, FileMeta) = state
        .db(move |conn| {
            let row = conn
                .query_row(
                    "SELECT f.sha256, f.orig_name, f.bytes, f.mime, n.owner_id, n.classroom_id
                       FROM files f JOIN nodes n ON n.id = f.node_id
                      WHERE f.node_id = ?1
                        AND NOT EXISTS (SELECT 1 FROM trashed_files t WHERE t.node_id = f.node_id)",
                    [id.to_string()],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, i64>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, Option<String>>(4)?,
                            r.get::<_, Option<String>>(5)?,
                        ))
                    },
                )
                .optional()?
                .ok_or(HostError::NotFound("file"))?;

            let (sha, orig_name, bytes, mime, owner_id, classroom_id) = row;
            match owner_id {
                None if user.0.role.is_teacher() => {
                    if let Some(classroom_id) = classroom_id {
                        let classroom_id = classroom_id.parse().map_err(|error| {
                            HostError::Other(anyhow::anyhow!("bad classroom id: {error}"))
                        })?;
                        if !teacher_can_access(conn, classroom_id, owner)? {
                            return Err(HostError::Forbidden);
                        }
                    }
                }
                None => {
                    if let Some(classroom_id) = classroom_id {
                        let enrolled: bool = conn.query_row(
                            "SELECT EXISTS(
                                SELECT 1
                                  FROM classroom_enrolments e
                                  JOIN classrooms c ON c.id = e.classroom_id
                                 WHERE e.classroom_id = ?1
                                   AND e.student_id = ?2
                                   AND c.archived_at IS NULL
                            )",
                            rusqlite::params![classroom_id, owner.to_string()],
                            |row| row.get(0),
                        )?;
                        if !enrolled {
                            return Err(HostError::Forbidden);
                        }
                    }
                }
                Some(ref o) if *o == owner.to_string() => {} // the student's own
                Some(_) => return Err(HostError::Forbidden),
            }

            Ok((
                sha,
                FileMeta {
                    node_id: id,
                    orig_name,
                    bytes,
                    mime,
                },
            ))
        })
        .await?;

    let (sha, meta) = meta;
    let path = blob_path(&state.files_dir, &sha);
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| HostError::Other(anyhow::anyhow!("opening blob: {e}")))?;

    let total = meta.bytes as u64;
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, total));

    // pdf.js asks for byte ranges so it can render page one of a large scan
    // without pulling the whole file over the lab LAN first.
    let (status, start, length) = match range {
        Some((start, end)) => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
        None => (StatusCode::OK, 0, total),
    };

    use tokio::io::AsyncSeekExt;
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|e| HostError::Other(anyhow::anyhow!("seeking blob: {e}")))?;
    let mut buffer = vec![0u8; length as usize];
    file.read_exact(&mut buffer)
        .await
        .map_err(|e| HostError::Other(anyhow::anyhow!("reading blob: {e}")))?;

    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, &meta.mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, length)
        // `inline` so the viewer renders it; the filename is quoted because
        // student uploads routinely contain spaces.
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{}\"", meta.orig_name.replace('"', "")),
        );

    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, start + length - 1, total),
        );
    }

    response
        .body(Body::from(buffer))
        .map_err(|e| HostError::Other(anyhow::anyhow!("building response: {e}")).into())
        .map(IntoResponse::into_response)
}

fn blob_path(root: &std::path::Path, digest: &str) -> PathBuf {
    root.join(&digest[0..2]).join(digest)
}

async fn cleanup_unreferenced_blob(state: &AppState, digest: String, path: &std::path::Path) {
    let referenced = state
        .db(move |conn| {
            Ok(conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM files WHERE sha256 = ?1)",
                [digest],
                |row| row.get::<_, bool>(0),
            )?)
        })
        .await
        .unwrap_or(true);
    if !referenced {
        let _ = tokio::fs::remove_file(path).await;
    }
}

/// Identifies a file from its leading bytes. Returns `None` for anything not on
/// the allow-list.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"%PDF-") {
        return Some("application/pdf");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

/// Turns an uploaded filename into something readable in the tree.
fn tidy_name(file_name: &str) -> String {
    let stem = std::path::Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Material");
    let cleaned = stem.replace(['_', '-'], " ");
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Material".to_owned()
    } else {
        trimmed.chars().take(120).collect()
    }
}

/// Parses a single `bytes=start-end` range. Multi-range requests are ignored,
/// which is allowed — the client just gets the whole file.
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let spec = header.strip_prefix("bytes=")?;
    if spec.contains(',') || total == 0 {
        return None;
    }
    let (start, end) = spec.split_once('-')?;

    let (start, end) = match (start.trim(), end.trim()) {
        ("", suffix) => {
            // `bytes=-500` means the last 500 bytes.
            let len: u64 = suffix.parse().ok()?;
            (total.saturating_sub(len), total - 1)
        }
        (from, "") => (from.parse().ok()?, total - 1),
        (from, to) => (from.parse().ok()?, to.parse::<u64>().ok()?.min(total - 1)),
    };

    if start > end || start >= total {
        return None;
    }
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::CurrentUser;
    use chrono::Utc;
    use cinder_ai::Ai;
    use cinder_core::{Role, User};
    use std::sync::Arc;
    use uuid::Uuid;

    #[test]
    fn sniffs_allowed_types_from_bytes_not_names() {
        assert_eq!(sniff(b"%PDF-1.7 ..."), Some("application/pdf"));
        assert_eq!(
            sniff(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]),
            Some("image/png")
        );
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff(b"GIF89a....."), Some("image/gif"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
    }

    #[test]
    fn rejects_anything_not_on_the_allow_list() {
        // An ELF binary renamed to .pdf is exactly the case sniffing catches.
        assert_eq!(sniff(&[0x7F, b'E', b'L', b'F']), None);
        assert_eq!(sniff(b"#!/bin/sh\n"), None);
        assert_eq!(sniff(b""), None);
        assert_eq!(sniff(b"PK\x03\x04"), None, "zip/docx is not accepted yet");
    }

    #[test]
    fn parses_byte_ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        // Clamp an end past the file rather than erroring.
        assert_eq!(parse_range("bytes=0-99999", 1000), Some((0, 999)));
    }

    #[test]
    fn rejects_nonsense_ranges() {
        assert_eq!(parse_range("bytes=900-100", 1000), None);
        assert_eq!(parse_range("bytes=5000-6000", 1000), None);
        assert_eq!(parse_range("items=0-10", 1000), None);
        assert_eq!(
            parse_range("bytes=0-10,20-30", 1000),
            None,
            "multi-range falls back"
        );
    }

    #[test]
    fn tidies_upload_names() {
        assert_eq!(tidy_name("optics_chapter-3.pdf"), "optics chapter 3");
        assert_eq!(tidy_name("scan.PNG"), "scan");
        assert_eq!(tidy_name(""), "Material");
    }

    #[test]
    fn shared_upload_requires_classroom_access_before_storage() {
        let pool = crate::db::open_in_memory().unwrap();
        let owner = Uuid::new_v4();
        let outsider = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let now = Utc::now();
        let conn = pool.get().unwrap();
        for (id, name) in [(owner, "owner"), (outsider, "outsider")] {
            conn.execute(
                "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                 VALUES (?1, ?2, ?2, 'hash', 'teacher', ?3)",
                rusqlite::params![id.to_string(), name, now.to_rfc3339()],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO classrooms
                (id, name, description, color, created_at, owner_teacher_id, enrolment_code)
             VALUES (?1, 'Science', '', '#BEC2FF', ?2, ?3, 'ABCDEFGH')",
            rusqlite::params![classroom.to_string(), now.to_rfc3339(), owner.to_string()],
        )
        .unwrap();
        let teacher = |id: Uuid, name: &str| {
            CurrentUser(
                User {
                    id,
                    username: name.into(),
                    display_name: name.into(),
                    role: Role::Teacher,
                    grade_level: None,
                    section: None,
                    roll_number: None,
                    must_change_password: false,
                    created_at: now,
                },
                "token".into(),
            )
        };
        let query = UploadQuery {
            parent_id: None,
            classroom_id: Some(classroom),
            shared: true,
        };
        assert!(authorize_upload(&conn, &teacher(owner, "owner"), query).is_ok());
        assert!(matches!(
            authorize_upload(&conn, &teacher(outsider, "outsider"), query),
            Err(HostError::Forbidden)
        ));
    }

    #[tokio::test]
    async fn late_upload_failure_removes_new_unreferenced_blob() {
        let pool = crate::db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let state = AppState {
            pool,
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let digest = "a".repeat(64);
        let path = blob_path(&state.files_dir, &digest);
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, b"new upload").await.unwrap();

        cleanup_unreferenced_blob(&state, digest, &path).await;

        assert!(!path.exists());
    }

    #[tokio::test]
    async fn archived_classroom_files_are_hidden_from_enrolled_students() {
        let pool = crate::db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let teacher_id = Uuid::new_v4();
        let student_id = Uuid::new_v4();
        let classroom_id = Uuid::new_v4();
        let node_id = Uuid::new_v4();
        let now = Utc::now();
        {
            let conn = pool.get().unwrap();
            for (id, username, role) in [
                (teacher_id, "teacher", "teacher"),
                (student_id, "student", "student"),
            ] {
                conn.execute(
                    "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                     VALUES (?1, ?2, ?2, 'hash', ?3, ?4)",
                    rusqlite::params![id.to_string(), username, role, now.to_rfc3339()],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO classrooms
                    (id, name, description, color, created_at, archived_at,
                     owner_teacher_id, enrolment_code)
                 VALUES (?1, 'Archived', '', '#BEC2FF', ?2, ?2, ?3, 'ARCHIVE1')",
                rusqlite::params![
                    classroom_id.to_string(),
                    now.to_rfc3339(),
                    teacher_id.to_string()
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO classroom_enrolments (classroom_id, student_id, created_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    classroom_id.to_string(),
                    student_id.to_string(),
                    now.to_rfc3339()
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO nodes
                    (id, owner_id, classroom_id, name, kind, position, created_at, updated_at)
                 VALUES (?1, NULL, ?2, 'Archived file', 'pdf', 1024, ?3, ?3)",
                rusqlite::params![
                    node_id.to_string(),
                    classroom_id.to_string(),
                    now.to_rfc3339()
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO files (node_id, sha256, orig_name, bytes, mime, created_at)
                 VALUES (?1, ?2, 'archived.pdf', 8, 'application/pdf', ?3)",
                rusqlite::params![node_id.to_string(), "b".repeat(64), now.to_rfc3339()],
            )
            .unwrap();
        }
        let state = AppState {
            pool,
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let student = CurrentUser(
            User {
                id: student_id,
                username: "student".into(),
                display_name: "student".into(),
                role: Role::Student,
                grade_level: None,
                section: None,
                roll_number: None,
                must_change_password: false,
                created_at: now,
            },
            "token".into(),
        );

        let result = download(State(state), student, Path(node_id), HeaderMap::new()).await;
        assert!(matches!(result, Err(HostError::Forbidden)));
    }
}
