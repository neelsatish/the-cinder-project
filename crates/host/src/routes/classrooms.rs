//! Teacher-owned classrooms and explicit student enrolment.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::{Path, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::Utc;
use cinder_core::{
    AddCoTeacherRequest, Classroom, ClassroomRoster, ClassroomTeachers, CreateClassroomRequest,
    EnrolStudentRequest, JoinClassroomRequest, Role, UpdateClassroomRequest, User,
};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/classrooms", get(list).post(create))
        .route("/api/classrooms/join", post(join))
        .route(
            "/api/classrooms/{id}",
            get(roster).patch(update).delete(archive),
        )
        .route("/api/classrooms/{id}/students", post(enrol))
        .route("/api/classrooms/{id}/students/{student_id}", delete(remove))
        .route(
            "/api/classrooms/{id}/teachers",
            get(classroom_teachers).post(add_co_teacher),
        )
        .route(
            "/api/classrooms/{id}/teachers/{teacher_id}",
            delete(remove_co_teacher),
        )
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
                "SELECT c.id, c.name, c.subject_code, c.description, c.color,
                        c.owner_teacher_id, owner.display_name, c.enrolment_code, c.created_at,
                        count(e.student_id)
                   FROM classrooms c
                   JOIN users owner ON owner.id = c.owner_teacher_id
                   LEFT JOIN classroom_enrolments e ON e.classroom_id = c.id
                  WHERE c.archived_at IS NULL
                    AND (c.owner_teacher_id = ?1 OR EXISTS(
                        SELECT 1 FROM classroom_teachers ct
                         WHERE ct.classroom_id = c.id AND ct.teacher_id = ?1
                    ))
                  GROUP BY c.id
                  ORDER BY lower(c.name)"
            } else {
                "SELECT c.id, c.name, c.subject_code, c.description, c.color,
                        c.owner_teacher_id, owner.display_name, c.enrolment_code, c.created_at,
                        (SELECT count(*) FROM classroom_enrolments all_e WHERE all_e.classroom_id = c.id)
                   FROM classrooms c
                   JOIN users owner ON owner.id = c.owner_teacher_id
                   JOIN classroom_enrolments e ON e.classroom_id = c.id
                  WHERE c.archived_at IS NULL AND e.student_id = ?1
                  ORDER BY lower(c.name)"
            };

            let mut stmt = conn.prepare(sql)?;
            let rows = stmt
                .query_map([user_id], classroom_row)?
                .collect::<Result<Vec<_>, _>>()?;
            let classrooms = rows
                .into_iter()
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
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let name = req.name.trim();
            if name.is_empty() {
                return Err(HostError::BadRequest("Classroom name is required.".into()));
            }
            let color = normalize_color(&req.color)?;
            let id = Uuid::new_v4();
            let now = Utc::now();
            let enrolment_code = random_classroom_code(conn)?;
            conn.execute(
                "INSERT INTO classrooms
                    (id, name, subject_code, description, color, owner_teacher_id,
                     enrolment_code, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    id.to_string(),
                    name,
                    req.subject_code.as_deref().map(str::trim),
                    req.description.trim(),
                    color,
                    teacher_id.to_string(),
                    enrolment_code,
                    now.to_rfc3339(),
                ],
            )?;
            load_classroom(conn, id).map(Json)
        })
        .await
}

async fn join(
    State(state): State<AppState>,
    student: CurrentUser,
    Json(req): Json<JoinClassroomRequest>,
) -> HostResult<Json<Classroom>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    let code = normalize_classroom_code(&req.code)?;
    state
        .db(move |conn| {
            let classroom_id = conn
                .query_row(
                    "SELECT id FROM classrooms
                      WHERE enrolment_code = ?1 COLLATE NOCASE AND archived_at IS NULL",
                    [code],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or(HostError::NotFound("classroom"))?;
            conn.execute(
                "INSERT INTO classroom_enrolments (classroom_id, student_id, created_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(classroom_id, student_id) DO NOTHING",
                rusqlite::params![
                    classroom_id,
                    student_id.to_string(),
                    Utc::now().to_rfc3339()
                ],
            )?;
            load_classroom(conn, parse_uuid(&classroom_id)?).map(Json)
        })
        .await
}

async fn update(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateClassroomRequest>,
) -> HostResult<Json<Classroom>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, id, teacher_id)?;
            let name = req.name.trim();
            if name.is_empty() {
                return Err(HostError::BadRequest("Classroom name is required.".into()));
            }
            let color = normalize_color(&req.color)?;
            conn.execute(
                "UPDATE classrooms
                    SET name = ?2, subject_code = ?3, description = ?4, color = ?5
                  WHERE id = ?1 AND archived_at IS NULL",
                rusqlite::params![
                    id.to_string(),
                    name,
                    req.subject_code
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty()),
                    req.description.trim(),
                    color,
                ],
            )?;
            load_classroom(conn, id).map(Json)
        })
        .await
}

async fn archive(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            require_classroom_owner(conn, id, teacher_id)?;
            let now = Utc::now().to_rfc3339();
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE classrooms SET archived_at = ?2 WHERE id = ?1 AND archived_at IS NULL",
                rusqlite::params![id.to_string(), now],
            )?;
            tx.execute(
                "UPDATE assignments SET status = 'closed', updated_at = ?2 WHERE classroom_id = ?1",
                rusqlite::params![id.to_string(), now],
            )?;
            tx.commit()?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

async fn roster(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<ClassroomRoster>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, id, teacher_id)?;
            let classroom = load_classroom(conn, id)?;
            let mut stmt = conn.prepare(
                "SELECT u.id, u.username, u.display_name, u.role, u.grade_level, u.section,
                        u.roll_number, u.must_change_password, u.created_at
                   FROM classroom_enrolments e
                   JOIN users u ON u.id = e.student_id
                  WHERE e.classroom_id = ?1
                    AND u.disabled_at IS NULL
                  ORDER BY lower(u.display_name)",
            )?;
            let rows = stmt
                .query_map([id.to_string()], user_row)?
                .collect::<Result<Vec<_>, _>>()?;
            let students = rows.into_iter().collect::<HostResult<Vec<_>>>()?;
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
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, id, teacher_id)?;
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
    let actor_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, id, actor_id)?;
            conn.execute(
                "DELETE FROM classroom_enrolments WHERE classroom_id = ?1 AND student_id = ?2",
                rusqlite::params![id.to_string(), student_id.to_string()],
            )?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

async fn classroom_teachers(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<ClassroomTeachers>> {
    teacher.require_teacher()?;
    let actor_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, id, actor_id)?;
            let classroom = load_classroom(conn, id)?;
            let owner = load_user(conn, classroom.owner_teacher_id)?;
            let mut stmt = conn.prepare(
                "SELECT u.id, u.username, u.display_name, u.role, u.grade_level, u.section,
                        u.roll_number, u.must_change_password, u.created_at
                   FROM classroom_teachers ct JOIN users u ON u.id = ct.teacher_id
                  WHERE ct.classroom_id = ?1 AND u.disabled_at IS NULL
                  ORDER BY lower(u.display_name)",
            )?;
            let co_teachers = stmt
                .query_map([id.to_string()], user_row)?
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(ClassroomTeachers { owner, co_teachers }))
        })
        .await
}

async fn add_co_teacher(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<AddCoTeacherRequest>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    let actor_id = teacher.id();
    state
        .db(move |conn| {
            require_classroom_owner(conn, id, actor_id)?;
            let classroom = load_classroom(conn, id)?;
            if req.teacher_id == classroom.owner_teacher_id {
                return Ok(Json(serde_json::json!({ "ok": true })));
            }
            let role = conn
                .query_row(
                    "SELECT role FROM users WHERE id = ?1 AND disabled_at IS NULL",
                    [req.teacher_id.to_string()],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if role.as_deref() != Some("teacher") {
                return Err(HostError::NotFound("teacher"));
            }
            conn.execute(
                "INSERT INTO classroom_teachers (classroom_id, teacher_id, added_by, created_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(classroom_id, teacher_id) DO NOTHING",
                rusqlite::params![
                    id.to_string(),
                    req.teacher_id.to_string(),
                    actor_id.to_string(),
                    Utc::now().to_rfc3339(),
                ],
            )?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

async fn remove_co_teacher(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path((id, teacher_id)): Path<(Uuid, Uuid)>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    let actor_id = teacher.id();
    state
        .db(move |conn| {
            require_classroom_owner(conn, id, actor_id)?;
            conn.execute(
                "DELETE FROM classroom_teachers WHERE classroom_id = ?1 AND teacher_id = ?2",
                rusqlite::params![id.to_string(), teacher_id.to_string()],
            )?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

fn load_classroom(conn: &rusqlite::Connection, id: Uuid) -> HostResult<Classroom> {
    conn.query_row(
        "SELECT c.id, c.name, c.subject_code, c.description, c.color,
                c.owner_teacher_id, owner.display_name, c.enrolment_code, c.created_at,
                count(e.student_id)
           FROM classrooms c
           JOIN users owner ON owner.id = c.owner_teacher_id
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
    let owner_teacher_id: String = row.get(5)?;
    let created_at: String = row.get(8)?;
    Ok((|| {
        Ok(Classroom {
            id: id
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("bad classroom id: {error}")))?,
            name: row.get(1)?,
            subject_code: row.get(2)?,
            description: row.get(3)?,
            color: row.get(4)?,
            owner_teacher_id: owner_teacher_id.parse().map_err(|error| {
                HostError::Other(anyhow::anyhow!("bad owner teacher id: {error}"))
            })?,
            owner_teacher_name: row.get(6)?,
            enrolment_code: row.get(7)?,
            created_at: created_at
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("bad timestamp: {error}")))?,
            student_count: row.get(9)?,
        })
    })())
}

pub(crate) fn teacher_can_access(
    conn: &rusqlite::Connection,
    classroom_id: Uuid,
    teacher_id: Uuid,
) -> HostResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM classrooms c
             WHERE c.id = ?1 AND c.archived_at IS NULL
               AND (c.owner_teacher_id = ?2 OR EXISTS(
                   SELECT 1 FROM classroom_teachers ct
                    WHERE ct.classroom_id = c.id AND ct.teacher_id = ?2
               ))
        )",
        rusqlite::params![classroom_id.to_string(), teacher_id.to_string()],
        |row| row.get(0),
    )?)
}

pub(crate) fn require_teacher_access(
    conn: &rusqlite::Connection,
    classroom_id: Uuid,
    teacher_id: Uuid,
) -> HostResult<()> {
    if teacher_can_access(conn, classroom_id, teacher_id)? {
        Ok(())
    } else {
        Err(HostError::Forbidden)
    }
}

fn require_classroom_owner(
    conn: &rusqlite::Connection,
    classroom_id: Uuid,
    teacher_id: Uuid,
) -> HostResult<()> {
    let owned: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM classrooms
          WHERE id = ?1 AND owner_teacher_id = ?2 AND archived_at IS NULL)",
        rusqlite::params![classroom_id.to_string(), teacher_id.to_string()],
        |row| row.get(0),
    )?;
    if owned {
        Ok(())
    } else {
        Err(HostError::Forbidden)
    }
}

fn load_user(conn: &rusqlite::Connection, id: Uuid) -> HostResult<User> {
    conn.query_row(
        "SELECT id, username, display_name, role, grade_level, section, roll_number,
                must_change_password, created_at
           FROM users WHERE id = ?1 AND disabled_at IS NULL",
        [id.to_string()],
        user_row,
    )
    .optional()?
    .ok_or(HostError::NotFound("teacher"))?
}

fn normalize_classroom_code(raw: &str) -> HostResult<String> {
    let code = raw.trim().to_ascii_uppercase();
    if code.len() == 8 && code.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        Ok(code)
    } else {
        Err(HostError::BadRequest(
            "Classroom code must contain exactly eight letters or numbers.".into(),
        ))
    }
}

fn random_classroom_code(conn: &rusqlite::Connection) -> HostResult<String> {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for _ in 0..20 {
        let mut code = String::with_capacity(8);
        while code.len() < 8 {
            let mut byte = [0u8; 1];
            OsRng.fill_bytes(&mut byte);
            if byte[0] < 224 {
                code.push(ALPHABET[byte[0] as usize % ALPHABET.len()] as char);
            }
        }
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM classrooms WHERE enrolment_code = ?1 COLLATE NOCASE)",
            [&code],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(code);
        }
    }
    Err(HostError::Other(anyhow::anyhow!(
        "could not generate a unique classroom code"
    )))
}

fn parse_uuid(value: &str) -> HostResult<Uuid> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad classroom id: {error}")))
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
    use super::{archive, join, normalize_color, teacher_can_access};
    use crate::auth::CurrentUser;
    use crate::{db, AppState};
    use axum::{
        extract::{Path, State},
        Json,
    };
    use chrono::Utc;
    use cinder_ai::Ai;
    use cinder_core::{JoinClassroomRequest, Role, User};
    use std::sync::Arc;
    use uuid::Uuid;

    #[test]
    fn classroom_color_is_normalized() {
        assert_eq!(normalize_color("#bec2ff").unwrap(), "#BEC2FF");
        assert!(normalize_color("lavender").is_err());
    }

    #[tokio::test]
    async fn classroom_access_and_join_code_follow_membership() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let owner = Uuid::new_v4();
        let co_teacher = Uuid::new_v4();
        let outsider = Uuid::new_v4();
        let student = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let now = Utc::now();
        {
            let conn = pool.get().unwrap();
            for (id, username, role) in [
                (owner, "owner", "teacher"),
                (co_teacher, "co", "teacher"),
                (outsider, "outsider", "teacher"),
                (student, "student", "student"),
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
                    (id, name, description, color, created_at, owner_teacher_id, enrolment_code)
                 VALUES (?1, 'Science', '', '#BEC2FF', ?2, ?3, 'ABCD2345')",
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
                    now.to_rfc3339(),
                ],
            )
            .unwrap();
            assert!(teacher_can_access(&conn, classroom, owner).unwrap());
            assert!(teacher_can_access(&conn, classroom, co_teacher).unwrap());
            assert!(!teacher_can_access(&conn, classroom, outsider).unwrap());
        }

        let state = AppState {
            pool: pool.clone(),
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let current_student = CurrentUser(
            User {
                id: student,
                username: "student".into(),
                display_name: "Student".into(),
                role: Role::Student,
                grade_level: None,
                section: None,
                roll_number: None,
                must_change_password: false,
                created_at: now,
            },
            "token".into(),
        );
        for _ in 0..2 {
            let Json(joined) = join(
                State(state.clone()),
                current_student.clone(),
                Json(JoinClassroomRequest {
                    code: "abcd2345".into(),
                }),
            )
            .await
            .unwrap();
            assert_eq!(joined.id, classroom);
        }
        let conn = pool.get().unwrap();
        let enrolments: i64 = conn
            .query_row(
                "SELECT count(*) FROM classroom_enrolments WHERE classroom_id = ?1",
                [classroom.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enrolments, 1, "joining twice must remain idempotent");
        drop(conn);

        let teacher_user = |id: Uuid, username: &str| {
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
        let co_teacher_result = archive(
            State(state.clone()),
            teacher_user(co_teacher, "co"),
            Path(classroom),
        )
        .await;
        assert!(matches!(
            co_teacher_result,
            Err(crate::error::HostError::Forbidden)
        ));
        let _ = archive(State(state), teacher_user(owner, "owner"), Path(classroom))
            .await
            .unwrap();
        let conn = pool.get().unwrap();
        let enrolments: i64 = conn
            .query_row(
                "SELECT count(*) FROM classroom_enrolments WHERE classroom_id = ?1",
                [classroom.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enrolments, 1, "archiving must preserve enrolment history");
    }
}
