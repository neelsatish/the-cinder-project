//! Authentication, first-run setup, recovery, and teacher-managed students.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use lumina_core::{
    AppLoginRequest, BootstrapTeacherRequest, BootstrapTeacherResponse, ChangePasswordRequest,
    CreateStudentRequest, CreateStudentResponse, LoginResponse, RecoverTeacherRequest, Role, User,
};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::{self, CurrentUser};
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/status", get(status))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/bootstrap", post(bootstrap))
        .route("/api/auth/recover", post(recover_teacher))
        .route("/api/auth/student-recover", post(recover_student))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/me", get(me))
        .route("/api/teacher/users", get(list_users).post(create_student))
        .route(
            "/api/teacher/users/{id}/reset-credentials",
            post(reset_student_credentials),
        )
}

async fn status(State(state): State<AppState>) -> HostResult<Json<serde_json::Value>> {
    state
        .db(|conn| {
            let users: i64 = conn.query_row("SELECT count(*) FROM users", [], |row| row.get(0))?;
            Ok(Json(serde_json::json!({ "needs_setup": users == 0 })))
        })
        .await
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<AppLoginRequest>,
) -> HostResult<Json<LoginResponse>> {
    state
        .db(move |conn| {
            let found = conn
                .query_row(
                    "SELECT id, username, display_name, pw_hash, role, created_at, disabled_at,
                            grade_level, section, roll_number, must_change_password
                       FROM users WHERE lower(username) = lower(?1)",
                    [&req.username],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, Option<String>>(6)?,
                            row.get::<_, Option<String>>(7)?,
                            row.get::<_, Option<String>>(8)?,
                            row.get::<_, Option<String>>(9)?,
                            row.get::<_, bool>(10)?,
                        ))
                    },
                )
                .optional()?;

            let Some((
                id,
                username,
                display_name,
                pw_hash,
                role,
                created_at,
                disabled_at,
                grade_level,
                section,
                roll_number,
                must_change_password,
            )) = found
            else {
                let _ = auth::verify_password(DUMMY_HASH, &req.password);
                return Err(HostError::BadCredentials);
            };

            let parsed_role = role
                .parse::<Role>()
                .map_err(|error| HostError::Other(anyhow::anyhow!("{error}")))?;
            if disabled_at.is_some()
                || parsed_role != req.expected_role
                || !auth::verify_password(&pw_hash, &req.password)
            {
                return Err(HostError::BadCredentials);
            }

            let now = Utc::now();
            let expires_at = auth::session_expiry(now);
            let (token, digest) = auth::new_token();

            conn.execute(
                "INSERT INTO sessions (token, user_id, device_label, created_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    digest,
                    id,
                    req.device_label,
                    now.to_rfc3339(),
                    expires_at.to_rfc3339()
                ],
            )?;
            conn.execute(
                "DELETE FROM sessions WHERE expires_at <= ?1",
                [now.to_rfc3339()],
            )?;

            Ok(Json(LoginResponse {
                token,
                user: User {
                    id: parse_uuid(&id, "user")?,
                    username,
                    display_name,
                    role: parsed_role,
                    grade_level,
                    section,
                    roll_number,
                    must_change_password,
                    created_at: created_at.parse().map_err(|error| {
                        HostError::Other(anyhow::anyhow!("bad created_at: {error}"))
                    })?,
                },
                expires_at,
            }))
        })
        .await
}

const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$c3R1ZHlib3hkdW1teXNhbHQ$b3JCJ0N0k1Zj3iWQxk7yLXJ7l1RfQvJmVXQ0kx5s2Yc";

async fn logout(
    State(state): State<AppState>,
    user: CurrentUser,
) -> HostResult<Json<serde_json::Value>> {
    let digest = user.token_digest().to_owned();
    state
        .db(move |conn| {
            conn.execute("DELETE FROM sessions WHERE token = ?1", [&digest])?;
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

async fn me(user: CurrentUser) -> Json<User> {
    Json(user.0)
}

async fn bootstrap(
    State(state): State<AppState>,
    Json(req): Json<BootstrapTeacherRequest>,
) -> HostResult<Json<BootstrapTeacherResponse>> {
    state
        .db(move |conn| {
            let count: i64 = conn.query_row("SELECT count(*) FROM users", [], |row| row.get(0))?;
            if count > 0 {
                return Err(HostError::Forbidden);
            }

            let tx = conn.transaction()?;
            let user = insert_user(
                &tx,
                &req.username,
                &req.display_name,
                &req.password,
                Role::Teacher,
                None,
                None,
                None,
                false,
            )?;
            let recovery_code = random_code(20);
            let recovery_hash = auth::hash_password(&recovery_code)?;
            tx.execute(
                "INSERT INTO teacher_recovery (user_id, recovery_hash, created_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![user.id.to_string(), recovery_hash, Utc::now().to_rfc3339()],
            )?;
            tx.commit()?;

            Ok(Json(BootstrapTeacherResponse {
                user,
                recovery_code,
            }))
        })
        .await
}

async fn create_student(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Json(req): Json<CreateStudentRequest>,
) -> HostResult<Json<CreateStudentResponse>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            let temporary_password = random_code(8);
            let recovery_code = random_code(20);
            let tx = conn.transaction()?;
            let user = insert_user(
                &tx,
                &req.username,
                &req.display_name,
                &temporary_password,
                Role::Student,
                req.grade_level,
                req.section,
                req.roll_number,
                true,
            )?;
            tx.execute(
                "INSERT INTO student_recovery (user_id, recovery_hash, created_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    user.id.to_string(),
                    auth::hash_password(&recovery_code)?,
                    Utc::now().to_rfc3339(),
                ],
            )?;
            tx.commit()?;
            Ok(Json(CreateStudentResponse {
                user,
                temporary_password,
                recovery_code,
            }))
        })
        .await
}

async fn reset_student_credentials(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(student_id): Path<Uuid>,
) -> HostResult<Json<CreateStudentResponse>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            let user = load_user(conn, &student_id.to_string())?;
            if user.role != Role::Student {
                return Err(HostError::BadRequest(
                    "Only student credentials can be reset here.".into(),
                ));
            }
            let temporary_password = random_code(8);
            let recovery_code = random_code(20);
            let now = Utc::now().to_rfc3339();
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE users SET pw_hash = ?2, must_change_password = 1 WHERE id = ?1",
                rusqlite::params![
                    student_id.to_string(),
                    auth::hash_password(&temporary_password)?
                ],
            )?;
            tx.execute(
                "DELETE FROM sessions WHERE user_id = ?1",
                [student_id.to_string()],
            )?;
            tx.execute(
                "INSERT INTO student_recovery (user_id, recovery_hash, created_at, rotated_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(user_id) DO UPDATE SET recovery_hash = excluded.recovery_hash,
                    rotated_at = excluded.rotated_at",
                rusqlite::params![
                    student_id.to_string(),
                    auth::hash_password(&recovery_code)?,
                    now
                ],
            )?;
            tx.commit()?;
            Ok(Json(CreateStudentResponse {
                user: load_user(conn, &student_id.to_string())?,
                temporary_password,
                recovery_code,
            }))
        })
        .await
}

async fn change_password(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(req): Json<ChangePasswordRequest>,
) -> HostResult<Json<User>> {
    let user_id = user.id().to_string();
    let current_token = user.token_digest().to_owned();
    state
        .db(move |conn| {
            let current_hash: String = conn.query_row(
                "SELECT pw_hash FROM users WHERE id = ?1",
                [&user_id],
                |row| row.get(0),
            )?;
            if !auth::verify_password(&current_hash, &req.current_password) {
                return Err(HostError::BadCredentials);
            }
            let new_hash = auth::hash_password(&req.new_password)?;
            conn.execute(
                "UPDATE users SET pw_hash = ?2, must_change_password = 0 WHERE id = ?1",
                rusqlite::params![user_id, new_hash],
            )?;
            conn.execute(
                "DELETE FROM sessions WHERE user_id = ?1 AND token <> ?2",
                rusqlite::params![user_id, current_token],
            )?;
            load_user(conn, &user_id).map(Json)
        })
        .await
}

async fn recover_teacher(
    State(state): State<AppState>,
    Json(req): Json<RecoverTeacherRequest>,
) -> HostResult<Json<BootstrapTeacherResponse>> {
    state
        .db(move |conn| {
            let found = conn
                .query_row(
                    "SELECT u.id, r.recovery_hash
                       FROM users u JOIN teacher_recovery r ON r.user_id = u.id
                      WHERE lower(u.username) = lower(?1) AND u.role = 'teacher'",
                    [&req.username],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let Some((user_id, recovery_hash)) = found else {
                let _ = auth::verify_password(DUMMY_HASH, &req.recovery_code);
                return Err(HostError::BadCredentials);
            };
            if !auth::verify_password(&recovery_hash, &req.recovery_code) {
                return Err(HostError::BadCredentials);
            }

            let new_hash = auth::hash_password(&req.new_password)?;
            let next_recovery = random_code(20);
            let next_recovery_hash = auth::hash_password(&next_recovery)?;
            let now = Utc::now().to_rfc3339();
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE users SET pw_hash = ?2 WHERE id = ?1",
                rusqlite::params![user_id, new_hash],
            )?;
            tx.execute("DELETE FROM sessions WHERE user_id = ?1", [&user_id])?;
            tx.execute(
                "UPDATE teacher_recovery
                    SET recovery_hash = ?2, rotated_at = ?3
                  WHERE user_id = ?1",
                rusqlite::params![user_id, next_recovery_hash, now],
            )?;
            tx.commit()?;

            Ok(Json(BootstrapTeacherResponse {
                user: load_user(conn, &user_id)?,
                recovery_code: next_recovery,
            }))
        })
        .await
}

async fn recover_student(
    State(state): State<AppState>,
    Json(req): Json<RecoverTeacherRequest>,
) -> HostResult<Json<BootstrapTeacherResponse>> {
    state
        .db(move |conn| {
            let found = conn
                .query_row(
                    "SELECT u.id, r.recovery_hash
                       FROM users u JOIN student_recovery r ON r.user_id = u.id
                      WHERE lower(u.username) = lower(?1) AND u.role = 'student'",
                    [&req.username],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let Some((user_id, recovery_hash)) = found else {
                let _ = auth::verify_password(DUMMY_HASH, &req.recovery_code);
                return Err(HostError::BadCredentials);
            };
            if !auth::verify_password(&recovery_hash, &req.recovery_code) {
                return Err(HostError::BadCredentials);
            }

            let next_recovery = random_code(20);
            let now = Utc::now().to_rfc3339();
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE users SET pw_hash = ?2, must_change_password = 0 WHERE id = ?1",
                rusqlite::params![user_id, auth::hash_password(&req.new_password)?],
            )?;
            tx.execute("DELETE FROM sessions WHERE user_id = ?1", [&user_id])?;
            tx.execute(
                "UPDATE student_recovery SET recovery_hash = ?2, rotated_at = ?3 WHERE user_id = ?1",
                rusqlite::params![user_id, auth::hash_password(&next_recovery)?, now],
            )?;
            tx.commit()?;
            Ok(Json(BootstrapTeacherResponse {
                user: load_user(conn, &user_id)?,
                recovery_code: next_recovery,
            }))
        })
        .await
}

async fn list_users(
    State(state): State<AppState>,
    teacher: CurrentUser,
) -> HostResult<Json<Vec<User>>> {
    teacher.require_teacher()?;
    state
        .db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM users WHERE role = 'student' ORDER BY lower(display_name)",
            )?;
            let ids = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let users = ids
                .iter()
                .map(|id| load_user(conn, id))
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(users))
        })
        .await
}

#[allow(clippy::too_many_arguments)]
fn insert_user(
    conn: &rusqlite::Connection,
    username: &str,
    display_name: &str,
    password: &str,
    role: Role,
    grade_level: Option<String>,
    section: Option<String>,
    roll_number: Option<String>,
    must_change_password: bool,
) -> HostResult<User> {
    let username = username.trim();
    let display_name = display_name.trim();
    if username.is_empty() || display_name.is_empty() {
        return Err(HostError::BadRequest(
            "Username and name are required.".into(),
        ));
    }
    if !username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
    {
        return Err(HostError::BadRequest(
            "Username can only contain letters, numbers, dots, dashes, and underscores.".into(),
        ));
    }

    let id = Uuid::new_v4();
    let now = Utc::now();
    let password_hash = auth::hash_password(password)?;
    conn.execute(
        "INSERT INTO users
            (id, username, display_name, pw_hash, role, created_at, grade_level, section,
             roll_number, must_change_password)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id.to_string(),
            username,
            display_name,
            password_hash,
            role.as_str(),
            now.to_rfc3339(),
            grade_level,
            section,
            roll_number,
            must_change_password,
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            HostError::BadRequest(format!("The username \"{username}\" is already taken."))
        }
        other => HostError::Database(other),
    })?;

    Ok(User {
        id,
        username: username.to_owned(),
        display_name: display_name.to_owned(),
        role,
        grade_level,
        section,
        roll_number,
        must_change_password,
        created_at: now,
    })
}

fn load_user(conn: &rusqlite::Connection, id: &str) -> HostResult<User> {
    conn.query_row(
        "SELECT id, username, display_name, role, grade_level, section, roll_number,
                must_change_password, created_at
           FROM users WHERE id = ?1",
        [id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, String>(8)?,
            ))
        },
    )
    .optional()?
    .ok_or(HostError::NotFound("user"))
    .and_then(|row| {
        Ok(User {
            id: parse_uuid(&row.0, "user")?,
            username: row.1,
            display_name: row.2,
            role: row
                .3
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("{error}")))?,
            grade_level: row.4,
            section: row.5,
            roll_number: row.6,
            must_change_password: row.7,
            created_at: row
                .8
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("bad timestamp: {error}")))?,
        })
    })
}

fn random_code(length: usize) -> String {
    // Avoid characters commonly confused on a printed account slip.
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut bytes = vec![0u8; length];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .into_iter()
        .map(|byte| ALPHABET[byte as usize % ALPHABET.len()] as char)
        .collect()
}

fn parse_uuid(value: &str, what: &str) -> HostResult<Uuid> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad {what} id: {error}")))
}

#[cfg(test)]
mod tests {
    use super::random_code;

    #[test]
    fn temporary_password_is_eight_readable_characters() {
        let code = random_code(8);
        assert_eq!(code.len(), 8);
        assert!(code
            .chars()
            .all(|character| character.is_ascii_alphanumeric()));
    }
}
