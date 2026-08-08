//! Teacher-owned classrooms and explicit student enrolment.

use axum::extract::{Path, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::Utc;
use lumina_core::{
    Classroom, ClassroomRoster, CreateClassroomRequest, EnrolStudentRequest, Role, User,
};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/classrooms", get(list).post(create))
        .route("/api/classrooms/{id}", get(roster))
        .route("/api/classrooms/{id}/students", post(enrol))
        .route("/api/classrooms/{id}/students/{student_id}", delete(remove))
}

async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
) -> HostResult<Json<Vec<Classroom>>> {
    let user_id = user.id().to_string();
    let is_teacher = user.0.role.is_teacher();
    state
        .db(move |conn| {
            let sql = if is_teacher {
                "SELECT c.id, c.name, c.subject_code, c.description, c.color, c.created_at,
                        count(e.student_id)
                   FROM classrooms c
                   LEFT JOIN classroom_enrolments e ON e.classroom_id = c.id
                  WHERE c.archived_at IS NULL
                  GROUP BY c.id
                  ORDER BY lower(c.name)"
            } else {
                "SELECT c.id, c.name, c.subject_code, c.description, c.color, c.created_at,
                        (SELECT count(*) FROM classroom_enrolments all_e WHERE all_e.classroom_id = c.id)
                   FROM classrooms c
                   JOIN classroom_enrolments e ON e.classroom_id = c.id
                  WHERE c.archived_at IS NULL AND e.student_id = ?1
                  ORDER BY lower(c.name)"
            };

            let mut stmt = conn.prepare(sql)?;
            let rows = if is_teacher {
                stmt.query_map([], classroom_row)?
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                stmt.query_map([user_id], classroom_row)?
                    .collect::<Result<Vec<_>, _>>()?
            };
            let classrooms = rows
                .into_iter()
                .map(|row| row?)
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(classrooms))
        })
        .await
}

async fn create(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Json(req): Json<CreateClassroomRequest>,
) -> HostResult<Json<Classroom>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            let name = req.name.trim();
            if name.is_empty() {
                return Err(HostError::BadRequest("Classroom name is required.".into()));
            }
            let color = normalize_color(&req.color)?;
            let id = Uuid::new_v4();
            let now = Utc::now();
            conn.execute(
                "INSERT INTO classrooms (id, name, subject_code, description, color, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    id.to_string(),
                    name,
                    req.subject_code.as_deref().map(str::trim),
                    req.description.trim(),
                    color,
                    now.to_rfc3339(),
                ],
            )?;
            Ok(Json(Classroom {
                id,
                name: name.to_owned(),
                subject_code: req.subject_code.map(|value| value.trim().to_owned()),
                description: req.description.trim().to_owned(),
                color,
                student_count: 0,
                created_at: now,
            }))
        })
        .await
}

async fn roster(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<ClassroomRoster>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            let classroom = load_classroom(conn, id)?;
            let mut stmt = conn.prepare(
                "SELECT u.id, u.username, u.display_name, u.role, u.grade_level, u.section,
                        u.roll_number, u.must_change_password, u.created_at
                   FROM classroom_enrolments e
                   JOIN users u ON u.id = e.student_id
                  WHERE e.classroom_id = ?1
                  ORDER BY lower(u.display_name)",
            )?;
            let rows = stmt
                .query_map([id.to_string()], user_row)?
                .collect::<Result<Vec<_>, _>>()?;
            let students = rows
                .into_iter()
                .map(|row| row?)
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(ClassroomRoster {
                classroom,
                students,
            }))
        })
        .await
}

async fn enrol(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<EnrolStudentRequest>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            load_classroom(conn, id)?;
            let role: Option<String> = conn
                .query_row(
                    "SELECT role FROM users WHERE id = ?1 AND disabled_at IS NULL",
                    [req.student_id.to_string()],
                    |row| row.get(0),
                )
                .optional()?;
            if role.as_deref() != Some("student") {
                return Err(HostError::NotFound("student"));
            }
            conn.execute(
                "INSERT INTO classroom_enrolments (classroom_id, student_id, created_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(classroom_id, student_id) DO NOTHING",
                rusqlite::params![
                    id.to_string(),
                    req.student_id.to_string(),
                    Utc::now().to_rfc3339()
                ],
            )?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

async fn remove(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path((id, student_id)): Path<(Uuid, Uuid)>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            conn.execute(
                "DELETE FROM classroom_enrolments WHERE classroom_id = ?1 AND student_id = ?2",
                rusqlite::params![id.to_string(), student_id.to_string()],
            )?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

fn load_classroom(conn: &rusqlite::Connection, id: Uuid) -> HostResult<Classroom> {
    conn.query_row(
        "SELECT c.id, c.name, c.subject_code, c.description, c.color, c.created_at,
                count(e.student_id)
           FROM classrooms c
           LEFT JOIN classroom_enrolments e ON e.classroom_id = c.id
          WHERE c.id = ?1 AND c.archived_at IS NULL
          GROUP BY c.id",
        [id.to_string()],
        classroom_row,
    )
    .optional()?
    .ok_or(HostError::NotFound("classroom"))?
}

fn classroom_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HostResult<Classroom>> {
    let id: String = row.get(0)?;
    let created_at: String = row.get(5)?;
    Ok((|| {
        Ok(Classroom {
            id: id
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("bad classroom id: {error}")))?,
            name: row.get(1)?,
            subject_code: row.get(2)?,
            description: row.get(3)?,
            color: row.get(4)?,
            created_at: created_at
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("bad timestamp: {error}")))?,
            student_count: row.get(6)?,
        })
    })())
}

fn user_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HostResult<User>> {
    let id: String = row.get(0)?;
    let role: String = row.get(3)?;
    let created_at: String = row.get(8)?;
    Ok((|| {
        Ok(User {
            id: id
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("bad user id: {error}")))?,
            username: row.get(1)?,
            display_name: row.get(2)?,
            role: role
                .parse::<Role>()
                .map_err(|error| HostError::Other(anyhow::anyhow!("{error}")))?,
            grade_level: row.get(4)?,
            section: row.get(5)?,
            roll_number: row.get(6)?,
            must_change_password: row.get(7)?,
            created_at: created_at
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("bad timestamp: {error}")))?,
        })
    })())
}

fn normalize_color(raw: &str) -> HostResult<String> {
    let value = raw.trim();
    if value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        Ok(value.to_ascii_uppercase())
    } else {
        Err(HostError::BadRequest(
            "Classroom color must be a six-digit hex color.".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_color;

    #[test]
    fn classroom_color_is_normalized() {
        assert_eq!(normalize_color("#bec2ff").unwrap(), "#BEC2FF");
        assert!(normalize_color("lavender").is_err());
    }
}
