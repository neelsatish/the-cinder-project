//! The subject organizer.
//!
//! One adjacency-list tree per student, plus the teacher's shared library
//! (`owner_id IS NULL`) which every student can read but only a teacher can change.

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use cinder_core::{
    CreateNodeRequest, Node, NodeKind, TreeResponse, UpdateNodeRequest, POSITION_STEP,
};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::db::PooledConn;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/tree", get(get_tree))
        .route("/api/nodes", post(create_node))
        .route(
            "/api/nodes/{id}",
            axum::routing::patch(update_node).delete(delete_node),
        )
}

async fn get_tree(
    State(state): State<AppState>,
    user: CurrentUser,
) -> HostResult<Json<TreeResponse>> {
    let owner = user.id().to_string();
    let teacher = user.0.role.is_teacher();
    state
        .db(move |conn| {
            let sql = if teacher {
                "SELECT id, owner_id, parent_id, classroom_id, name, kind, position, icon, created_at, updated_at
                   FROM nodes WHERE owner_id = ?1 OR owner_id IS NULL
                  ORDER BY position, lower(name)"
            } else {
                "SELECT id, owner_id, parent_id, classroom_id, name, kind, position, icon, created_at, updated_at
                   FROM nodes n
                  WHERE n.owner_id = ?1
                     OR (n.owner_id IS NULL AND (
                         n.classroom_id IS NULL OR EXISTS(
                           SELECT 1 FROM classroom_enrolments e
                            WHERE e.classroom_id = n.classroom_id AND e.student_id = ?1
                         )
                     ))
                  ORDER BY position, lower(name)"
            };
            let mut stmt = conn.prepare(sql)?;
            let nodes = stmt
                .query_map([&owner], row_to_node)?
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .collect::<HostResult<Vec<Node>>>()?;

            Ok(Json(TreeResponse { nodes }))
        })
        .await
}

async fn create_node(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(req): Json<CreateNodeRequest>,
) -> HostResult<Json<Node>> {
    let owner = user.id();
    state
        .db(move |conn| {
            let name = req.name.trim();
            if name.is_empty() {
                return Err(HostError::BadRequest("Name cannot be empty.".into()));
            }

            if let Some(parent_id) = req.parent_id {
                let parent = load_node(conn, parent_id)?;
                assert_writable(&parent, owner)?;
                if !parent.kind.can_have_children() {
                    return Err(HostError::BadRequest(
                        "You can only put things inside a folder.".into(),
                    ));
                }
                if parent.classroom_id != req.classroom_id {
                    return Err(HostError::BadRequest(
                        "A folder and its contents must belong to the same classroom.".into(),
                    ));
                }
            }

            if let Some(classroom_id) = req.classroom_id {
                let enrolled: bool = conn.query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM classroom_enrolments
                         WHERE classroom_id = ?1 AND student_id = ?2
                    )",
                    rusqlite::params![classroom_id.to_string(), owner.to_string()],
                    |row| row.get(0),
                )?;
                if !enrolled && !user.0.role.is_teacher() {
                    return Err(HostError::Forbidden);
                }
            }

            let tx = conn.transaction()?;
            let position = next_position(&tx, req.parent_id, owner)?;
            let id = Uuid::new_v4();
            let now = Utc::now();

            tx.execute(
                "INSERT INTO nodes
                    (id, owner_id, parent_id, classroom_id, name, kind, position, icon, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                rusqlite::params![
                    id.to_string(),
                    owner.to_string(),
                    req.parent_id.map(|p| p.to_string()),
                    req.classroom_id.map(|value| value.to_string()),
                    name,
                    req.kind.as_str(),
                    position,
                    req.icon,
                    now.to_rfc3339(),
                ],
            )?;

            // A note is useless without a body row, and creating it here means
            // the editor never has to handle a "note that has no content yet".
            if req.kind == NodeKind::Note {
                tx.execute(
                    "INSERT INTO note_bodies (node_id, doc_json, plaintext, updated_at)
                     VALUES (?1, ?2, '', ?3)",
                    rusqlite::params![id.to_string(), EMPTY_DOC, now.to_rfc3339()],
                )?;
            }

            tx.commit()?;

            Ok(Json(Node {
                id,
                owner_id: Some(owner),
                parent_id: req.parent_id,
                classroom_id: req.classroom_id,
                name: name.to_owned(),
                kind: req.kind,
                position,
                icon: req.icon,
                created_at: now,
                updated_at: now,
            }))
        })
        .await
}

/// An empty ProseMirror document.
const EMPTY_DOC: &str = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;

async fn update_node(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateNodeRequest>,
) -> HostResult<Json<Node>> {
    let owner = user.id();
    state
        .db(move |conn| {
            let existing = load_node(conn, id)?;
            assert_writable(&existing, owner)?;

            let tx = conn.transaction()?;

            if let Some(new_parent) = req.parent_id {
                if let Some(parent_id) = new_parent {
                    let parent = load_node_tx(&tx, parent_id)?;
                    assert_writable(&parent, owner)?;
                    if !parent.kind.can_have_children() {
                        return Err(HostError::BadRequest(
                            "You can only put things inside a folder.".into(),
                        ));
                    }
                    if would_create_cycle(&tx, id, parent_id)? {
                        return Err(HostError::BadRequest(
                            "You cannot move a folder into itself.".into(),
                        ));
                    }
                }
                tx.execute(
                    "UPDATE nodes SET parent_id = ?2 WHERE id = ?1",
                    rusqlite::params![id.to_string(), new_parent.map(|p| p.to_string())],
                )?;
            }

            if let Some(name) = req.name.as_deref() {
                let name = name.trim();
                if name.is_empty() {
                    return Err(HostError::BadRequest("Name cannot be empty.".into()));
                }
                tx.execute(
                    "UPDATE nodes SET name = ?2 WHERE id = ?1",
                    rusqlite::params![id.to_string(), name],
                )?;
            }

            if let Some(position) = req.position {
                tx.execute(
                    "UPDATE nodes SET position = ?2 WHERE id = ?1",
                    rusqlite::params![id.to_string(), position],
                )?;
            }

            if let Some(icon) = req.icon.as_deref() {
                tx.execute(
                    "UPDATE nodes SET icon = ?2 WHERE id = ?1",
                    rusqlite::params![id.to_string(), icon],
                )?;
            }

            tx.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                rusqlite::params![id.to_string(), Utc::now().to_rfc3339()],
            )?;

            let updated = load_node_tx(&tx, id)?;
            tx.commit()?;
            Ok(Json(updated))
        })
        .await
}

async fn delete_node(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    let owner = user.id();
    state
        .db(move |conn| {
            let existing = load_node(conn, id)?;
            assert_writable(&existing, owner)?;
            // Children go with it via ON DELETE CASCADE, which is why
            // `foreign_keys = ON` is set on every pooled connection.
            conn.execute("DELETE FROM nodes WHERE id = ?1", [id.to_string()])?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

// ------------------------------------------------------------------ helpers

/// Students may only touch their own nodes. The shared library is readable by
/// everyone and writable by teachers.
fn assert_writable(node: &Node, owner: Uuid) -> HostResult<()> {
    match node.owner_id {
        Some(id) if id == owner => Ok(()),
        _ => Err(HostError::Forbidden),
    }
}

fn next_position(
    conn: &rusqlite::Connection,
    parent_id: Option<Uuid>,
    owner: Uuid,
) -> HostResult<i64> {
    let max: Option<i64> = match parent_id {
        Some(parent) => conn.query_row(
            "SELECT max(position) FROM nodes WHERE parent_id = ?1",
            [parent.to_string()],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT max(position) FROM nodes WHERE parent_id IS NULL AND owner_id = ?1",
            [owner.to_string()],
            |r| r.get(0),
        )?,
    };
    Ok(max.unwrap_or(0) + POSITION_STEP)
}

/// Walks up from `new_parent`; if we reach `moving`, the move would detach a
/// subtree from the root and orphan it.
fn would_create_cycle(
    conn: &rusqlite::Connection,
    moving: Uuid,
    new_parent: Uuid,
) -> HostResult<bool> {
    let mut cursor = Some(new_parent);
    // Bounded so a pre-existing cycle in the data cannot hang the request.
    for _ in 0..512 {
        let Some(current) = cursor else {
            return Ok(false);
        };
        if current == moving {
            return Ok(true);
        }
        let parent: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM nodes WHERE id = ?1",
                [current.to_string()],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        cursor = match parent {
            Some(p) => Some(p.parse().map_err(|e| {
                HostError::Other(anyhow::anyhow!("bad parent id in database: {e}"))
            })?),
            None => None,
        };
    }
    Err(HostError::Other(anyhow::anyhow!(
        "node tree is deeper than 512 levels, refusing to walk it"
    )))
}

fn load_node(conn: &PooledConn, id: Uuid) -> HostResult<Node> {
    load_node_tx(conn, id)
}

fn load_node_tx(conn: &rusqlite::Connection, id: Uuid) -> HostResult<Node> {
    conn.query_row(
        "SELECT id, owner_id, parent_id, classroom_id, name, kind, position, icon, created_at, updated_at
           FROM nodes WHERE id = ?1",
        [id.to_string()],
        row_to_node,
    )
    .optional()?
    .ok_or(HostError::NotFound("node"))?
}

#[allow(clippy::type_complexity)]
fn row_to_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<HostResult<Node>> {
    let id: String = row.get(0)?;
    let owner_id: Option<String> = row.get(1)?;
    let parent_id: Option<String> = row.get(2)?;
    let classroom_id: Option<String> = row.get(3)?;
    let name: String = row.get(4)?;
    let kind: String = row.get(5)?;
    let position: i64 = row.get(6)?;
    let icon: Option<String> = row.get(7)?;
    let created_at: String = row.get(8)?;
    let updated_at: String = row.get(9)?;

    Ok((|| {
        let bad = |what: &str, e: String| HostError::Other(anyhow::anyhow!("bad {what}: {e}"));
        Ok(Node {
            id: id
                .parse()
                .map_err(|e: uuid::Error| bad("node id", e.to_string()))?,
            owner_id: owner_id
                .map(|v| v.parse())
                .transpose()
                .map_err(|e: uuid::Error| bad("owner id", e.to_string()))?,
            parent_id: parent_id
                .map(|v| v.parse())
                .transpose()
                .map_err(|e: uuid::Error| bad("parent id", e.to_string()))?,
            classroom_id: classroom_id
                .map(|value| value.parse())
                .transpose()
                .map_err(|error: uuid::Error| bad("classroom id", error.to_string()))?,
            name,
            kind: kind.parse().map_err(|e| bad("node kind", format!("{e}")))?,
            position,
            icon,
            created_at: created_at
                .parse()
                .map_err(|e: chrono::ParseError| bad("created_at", e.to_string()))?,
            updated_at: updated_at
                .parse()
                .map_err(|e: chrono::ParseError| bad("updated_at", e.to_string()))?,
        })
    })())
}
