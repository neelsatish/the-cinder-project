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
use crate::routes::classrooms::teacher_can_access;
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
                   FROM nodes n
                  WHERE NOT EXISTS (SELECT 1 FROM trashed_files t WHERE t.node_id = n.id)
                    AND (n.owner_id = ?1
                     OR (n.owner_id IS NULL AND (
                         n.classroom_id IS NULL OR EXISTS(
                           SELECT 1 FROM classrooms c
                            WHERE c.id = n.classroom_id AND c.archived_at IS NULL
                              AND (c.owner_teacher_id = ?1 OR EXISTS(
                                  SELECT 1 FROM classroom_teachers ct
                                   WHERE ct.classroom_id = c.id AND ct.teacher_id = ?1
                              ))
                         )
                     )))
                  ORDER BY position, lower(name)"
            } else {
                "SELECT id, owner_id, parent_id, classroom_id, name, kind, position, icon, created_at, updated_at
                   FROM nodes n
                  WHERE NOT EXISTS (SELECT 1 FROM trashed_files t WHERE t.node_id = n.id)
                    AND (n.owner_id = ?1
                     OR (n.owner_id IS NULL AND (
                         n.classroom_id IS NULL OR EXISTS(
                           SELECT 1
                             FROM classroom_enrolments e
                             JOIN classrooms c ON c.id = e.classroom_id
                            WHERE e.classroom_id = n.classroom_id
                              AND e.student_id = ?1
                              AND c.archived_at IS NULL
                         )
                     )))
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
                assert_personal_writable(&parent, owner)?;
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
                let allowed = if user.0.role.is_teacher() {
                    teacher_can_access(conn, classroom_id, owner)?
                } else {
                    conn.query_row(
                        "SELECT EXISTS(
                            SELECT 1 FROM classroom_enrolments
                             WHERE classroom_id = ?1 AND student_id = ?2
                        )",
                        rusqlite::params![classroom_id.to_string(), owner.to_string()],
                        |row| row.get(0),
                    )?
                };
                if !allowed {
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
    state
        .db(move |conn| {
            let existing = load_node(conn, id)?;
            assert_writable(conn, &existing, &user)?;

            let tx = conn.transaction()?;

            if let Some(new_parent) = req.parent_id {
                if let Some(parent_id) = new_parent {
                    let parent = load_node_tx(&tx, parent_id)?;
                    assert_writable(&tx, &parent, &user)?;
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
                    if parent.owner_id != existing.owner_id
                        || parent.classroom_id != existing.classroom_id
                    {
                        return Err(HostError::BadRequest(
                            "A folder and its contents must have the same owner and classroom."
                                .into(),
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
    state
        .db(move |conn| {
            let existing = load_node(conn, id)?;
            assert_writable(conn, &existing, &user)?;
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
fn assert_personal_writable(node: &Node, owner: Uuid) -> HostResult<()> {
    match node.owner_id {
        Some(id) if id == owner => Ok(()),
        _ => Err(HostError::Forbidden),
    }
}

fn assert_writable(conn: &rusqlite::Connection, node: &Node, user: &CurrentUser) -> HostResult<()> {
    match node.owner_id {
        Some(id) if id == user.id() => Ok(()),
        None if user.0.role.is_teacher() => {
            if let Some(classroom_id) = node.classroom_id {
                if !teacher_can_access(conn, classroom_id, user.id())? {
                    return Err(HostError::Forbidden);
                }
            }
            Ok(())
        }
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

#[cfg(test)]
mod tests {
    use super::{assert_writable, delete_node, get_tree, load_node, update_node};
    use crate::auth::CurrentUser;
    use crate::{db, AppState};
    use axum::extract::{Path, State};
    use axum::Json;
    use chrono::Utc;
    use cinder_ai::Ai;
    use cinder_core::{Role, UpdateNodeRequest, User};
    use std::sync::Arc;
    use uuid::Uuid;

    fn user(id: Uuid, username: &str, role: Role, now: chrono::DateTime<Utc>) -> CurrentUser {
        CurrentUser(
            User {
                id,
                username: username.into(),
                display_name: username.into(),
                role,
                grade_level: None,
                section: None,
                roll_number: None,
                must_change_password: false,
                created_at: now,
            },
            "token".into(),
        )
    }

    #[tokio::test]
    async fn shared_classroom_nodes_follow_teacher_access_and_stay_in_their_tree() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let owner = Uuid::new_v4();
        let co_teacher = Uuid::new_v4();
        let outsider = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let shared = Uuid::new_v4();
        let personal_folder = Uuid::new_v4();
        let now = Utc::now();
        {
            let conn = pool.get().unwrap();
            for (id, username) in [(owner, "owner"), (co_teacher, "co"), (outsider, "outsider")] {
                conn.execute(
                    "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                     VALUES (?1, ?2, ?2, 'hash', 'teacher', ?3)",
                    rusqlite::params![id.to_string(), username, now.to_rfc3339()],
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
            conn.execute(
                "INSERT INTO classroom_teachers (classroom_id, teacher_id, added_by, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    classroom.to_string(),
                    co_teacher.to_string(),
                    owner.to_string(),
                    now.to_rfc3339()
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO nodes
                    (id, owner_id, classroom_id, name, kind, position, created_at, updated_at)
                 VALUES (?1, NULL, ?2, 'Material', 'pdf', 1024, ?3, ?3)",
                rusqlite::params![shared.to_string(), classroom.to_string(), now.to_rfc3339()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO nodes
                    (id, owner_id, name, kind, position, created_at, updated_at)
                 VALUES (?1, ?2, 'Personal', 'folder', 1024, ?3, ?3)",
                rusqlite::params![
                    personal_folder.to_string(),
                    co_teacher.to_string(),
                    now.to_rfc3339()
                ],
            )
            .unwrap();
        }
        let state = AppState {
            pool: pool.clone(),
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let teacher = |id: Uuid, username: &str| {
            CurrentUser(
                User {
                    id,
                    username: username.into(),
                    display_name: username.into(),
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

        let Json(renamed) = update_node(
            State(state.clone()),
            teacher(co_teacher, "co"),
            Path(shared),
            Json(UpdateNodeRequest {
                name: Some("Renamed".into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap();
        assert_eq!(renamed.name, "Renamed");

        let invalid_move = update_node(
            State(state.clone()),
            teacher(co_teacher, "co"),
            Path(shared),
            Json(UpdateNodeRequest {
                parent_id: Some(Some(personal_folder)),
                ..Default::default()
            }),
        )
        .await;
        assert!(matches!(
            invalid_move,
            Err(crate::error::HostError::BadRequest(_))
        ));

        let unrelated_delete = delete_node(
            State(state.clone()),
            teacher(outsider, "outsider"),
            Path(shared),
        )
        .await;
        assert!(matches!(
            unrelated_delete,
            Err(crate::error::HostError::Forbidden)
        ));

        let _ = delete_node(State(state), teacher(owner, "owner"), Path(shared))
            .await
            .unwrap();
    }

    #[test]
    fn global_shared_nodes_are_teacher_writable_but_private_nodes_are_owner_only() {
        let pool = db::open_in_memory().unwrap();
        let teacher_id = Uuid::new_v4();
        let student_id = Uuid::new_v4();
        let global_id = Uuid::new_v4();
        let private_id = Uuid::new_v4();
        let now = Utc::now();
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
            "INSERT INTO nodes
                (id, owner_id, name, kind, position, created_at, updated_at)
             VALUES (?1, NULL, 'Legacy shared', 'folder', 1024, ?3, ?3),
                    (?2, ?4, 'Private', 'folder', 2048, ?3, ?3)",
            rusqlite::params![
                global_id.to_string(),
                private_id.to_string(),
                now.to_rfc3339(),
                student_id.to_string()
            ],
        )
        .unwrap();

        let global = load_node(&conn, global_id).unwrap();
        let private = load_node(&conn, private_id).unwrap();
        let teacher = user(teacher_id, "teacher", Role::Teacher, now);
        let student = user(student_id, "student", Role::Student, now);
        assert!(assert_writable(&conn, &global, &teacher).is_ok());
        assert!(matches!(
            assert_writable(&conn, &global, &student),
            Err(crate::error::HostError::Forbidden)
        ));
        assert!(assert_writable(&conn, &private, &student).is_ok());
        assert!(matches!(
            assert_writable(&conn, &private, &teacher),
            Err(crate::error::HostError::Forbidden)
        ));
    }

    #[tokio::test]
    async fn archived_classroom_nodes_are_hidden_from_enrolled_students() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let teacher_id = Uuid::new_v4();
        let student_id = Uuid::new_v4();
        let classroom_id = Uuid::new_v4();
        let archived_node = Uuid::new_v4();
        let global_node = Uuid::new_v4();
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
                 VALUES (?1, NULL, ?2, 'Archived material', 'pdf', 1024, ?3, ?3),
                        (?4, NULL, NULL, 'School material', 'pdf', 2048, ?3, ?3)",
                rusqlite::params![
                    archived_node.to_string(),
                    classroom_id.to_string(),
                    now.to_rfc3339(),
                    global_node.to_string()
                ],
            )
            .unwrap();
        }
        let state = AppState {
            pool,
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };

        let Json(tree) = get_tree(
            State(state),
            user(student_id, "student", Role::Student, now),
        )
        .await
        .unwrap();
        assert!(tree.nodes.iter().any(|node| node.id == global_node));
        assert!(!tree.nodes.iter().any(|node| node.id == archived_node));
    }
}
