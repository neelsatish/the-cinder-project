//! Authentication, first-run setup, recovery, and teacher-managed students.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::{ConnectInfo, Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use cinder_core::{
    AppLoginRequest, BootstrapTeacherRequest, BootstrapTeacherResponse, ChangePasswordRequest,
    CreateStudentRequest, CreateStudentResponse, CreateTeacherRequest, DeleteTeacherRequest,
    LoginResponse, RecoverTeacherRequest, RegisterTeacherRequest, Role, UpdateStudentRequest, User,
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
        .route("/api/auth/register-teacher", post(register_teacher))
        .route("/api/auth/recover", post(recover_teacher))
        .route("/api/auth/student-recover", post(recover_student))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/me", get(me))
        .route(
            "/api/teacher/accounts",
            get(list_teachers).post(create_teacher),
        )
        .route(
            "/api/teacher/accounts/{id}",
            axum::routing::delete(delete_teacher),
        )
        .route("/api/teacher/users", get(list_users).post(create_student))
        .route(
            "/api/teacher/users/{id}",
            axum::routing::patch(update_student).delete(delete_student),
        )
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
    if req.username.chars().count() > 64
        || req.password.chars().count() > auth::MAX_PASSWORD_CHARS
        || req
            .device_label
            .as_deref()
            .is_some_and(|label| label.chars().count() > 120)
    {
        return Err(HostError::BadCredentials);
    }
    state
        .db(move |conn| {
            let found = conn
                .query_row(
                    "SELECT id, username, display_name, pw_hash, role, created_at, disabled_at,
                            grade_level, section, roll_number, must_change_password,
                            failed_login_attempts, login_blocked_until
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
                            row.get::<_, i64>(11)?,
                            row.get::<_, Option<String>>(12)?,
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
                failed_login_attempts,
                login_blocked_until,
            )) = found
            else {
                let _ = auth::verify_password(DUMMY_HASH, &req.password);
                return Err(HostError::BadCredentials);
            };

            let parsed_role = role
                .parse::<Role>()
                .map_err(|error| HostError::Other(anyhow::anyhow!("{error}")))?;
            let now = Utc::now();
            if login_blocked_until
                .as_deref()
                .and_then(|value| value.parse().ok())
                .is_some_and(|until: chrono::DateTime<Utc>| until > now)
            {
                return Err(HostError::RateLimited);
            }
            if disabled_at.is_some() || parsed_role != req.expected_role {
                return Err(HostError::BadCredentials);
            }

            if !auth::verify_password(&pw_hash, &req.password) {
                let attempts = failed_login_attempts + 1;
                if attempts >= 5 {
                    conn.execute(
                        "UPDATE users SET failed_login_attempts = 0, login_blocked_until = ?2 WHERE id = ?1",
                        rusqlite::params![id, (now + Duration::minutes(5)).to_rfc3339()],
                    )?;
                    return Err(HostError::RateLimited);
                }
                conn.execute(
                    "UPDATE users SET failed_login_attempts = ?2 WHERE id = ?1",
                    rusqlite::params![id, attempts],
                )?;
                return Err(HostError::BadCredentials);
            }

            conn.execute(
                "UPDATE users SET failed_login_attempts = 0, login_blocked_until = NULL WHERE id = ?1",
                [&id],
            )?;

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
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    Json(req): Json<BootstrapTeacherRequest>,
) -> HostResult<Json<BootstrapTeacherResponse>> {
    if !peer.ip().is_loopback() {
        return Err(HostError::Forbidden);
    }
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

async fn register_teacher(
    State(state): State<AppState>,
    Json(req): Json<RegisterTeacherRequest>,
) -> HostResult<Json<BootstrapTeacherResponse>> {
    state
        .db(move |conn| {
            let authorized = {
                let mut statement = conn.prepare(
                    "SELECT r.recovery_hash
                       FROM teacher_recovery r
                       JOIN users u ON u.id = r.user_id
                      WHERE u.role = 'teacher' AND u.disabled_at IS NULL",
                )?;
                let hashes = statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                hashes.iter().any(|hash| auth::verify_password(hash, &req.school_recovery_code))
            };
            if !authorized {
                return Err(HostError::BadCredentials);
            }
            if req.password.len() < 8 {
                return Err(HostError::BadRequest("Use at least 8 characters for the password.".into()));
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
            tx.execute(
                "INSERT INTO teacher_recovery (user_id, recovery_hash, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    user.id.to_string(),
                    auth::hash_password(&recovery_code)?,
                    Utc::now().to_rfc3339()
                ],
            )?;
            tx.commit()?;
            Ok(Json(BootstrapTeacherResponse { user, recovery_code }))
        })
        .await
}

async fn list_teachers(
    State(state): State<AppState>,
    teacher: CurrentUser,
) -> HostResult<Json<Vec<User>>> {
    teacher.require_teacher()?;
    state
        .db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM users WHERE role = 'teacher' AND disabled_at IS NULL ORDER BY lower(display_name)",
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

async fn create_teacher(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Json(req): Json<CreateTeacherRequest>,
) -> HostResult<Json<BootstrapTeacherResponse>> {
    teacher.require_teacher()?;
    if req.password.len() < 8 {
        return Err(HostError::BadRequest(
            "Use at least 8 characters for the password.".into(),
        ));
    }
    state
        .db(move |conn| {
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
            tx.execute(
                "INSERT INTO teacher_recovery (user_id, recovery_hash, created_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    user.id.to_string(),
                    auth::hash_password(&recovery_code)?,
                    Utc::now().to_rfc3339()
                ],
            )?;
            tx.commit()?;
            Ok(Json(BootstrapTeacherResponse {
                user,
                recovery_code,
            }))
        })
        .await
}

async fn delete_teacher(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(teacher_id): Path<Uuid>,
    Json(req): Json<DeleteTeacherRequest>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    let actor_id = teacher.id().to_string();
    state
        .db(move |conn| {
            let actor_hash: String = conn.query_row(
                "SELECT pw_hash FROM users WHERE id = ?1 AND role = 'teacher' AND disabled_at IS NULL",
                [&actor_id],
                |row| row.get(0),
            )?;
            if !auth::verify_password(&actor_hash, &req.current_password) {
                return Err(HostError::BadCredentials);
            }

            let target = load_user(conn, &teacher_id.to_string())?;
            if target.role != Role::Teacher {
                return Err(HostError::BadRequest(
                    "Only teacher accounts can be removed here.".into(),
                ));
            }
            let active_teachers: i64 = conn.query_row(
                "SELECT count(*) FROM users WHERE role = 'teacher' AND disabled_at IS NULL",
                [],
                |row| row.get(0),
            )?;
            if active_teachers <= 1 {
                return Err(HostError::BadRequest(
                    "Create another teacher account before deleting the final teacher.".into(),
                ));
            }

            let target_id = teacher_id.to_string();
            let tx = conn.transaction()?;
            let changed = tx.execute(
                "UPDATE users SET disabled_at = ?2 WHERE id = ?1 AND role = 'teacher' AND disabled_at IS NULL",
                rusqlite::params![target_id, Utc::now().to_rfc3339()],
            )?;
            if changed == 0 {
                return Err(HostError::NotFound("teacher"));
            }
            tx.execute("DELETE FROM sessions WHERE user_id = ?1", [&target_id])?;
            tx.commit()?;
            Ok(Json(serde_json::json!({
                "ok": true,
                "deleted_current": target_id == actor_id
            })))
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
            let temporary_password = random_pin();
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
            let temporary_password = random_pin();
            let recovery_code = random_code(20);
            let now = Utc::now().to_rfc3339();
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE users SET pw_hash = ?2, must_change_password = 1 WHERE id = ?1",
                rusqlite::params![
                    student_id.to_string(),
                    auth::hash_temporary_pin(&temporary_password)?
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
                "SELECT id FROM users WHERE role = 'student' AND disabled_at IS NULL ORDER BY lower(display_name)",
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

async fn update_student(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(student_id): Path<Uuid>,
    Json(req): Json<UpdateStudentRequest>,
) -> HostResult<Json<User>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            let existing = load_user(conn, &student_id.to_string())?;
            if existing.role != Role::Student {
                return Err(HostError::BadRequest("Only student accounts can be edited here.".into()));
            }
            let username = req.username.trim();
            let display_name = req.display_name.trim();
            validate_identity(username, display_name)?;
            conn.execute(
                "UPDATE users
                    SET username = ?2, display_name = ?3, grade_level = ?4, section = ?5, roll_number = ?6
                  WHERE id = ?1 AND role = 'student' AND disabled_at IS NULL",
                rusqlite::params![
                    student_id.to_string(),
                    username,
                    display_name,
                    clean_optional(req.grade_level, "Grade level")?,
                    clean_optional(req.section, "Section")?,
                    clean_optional(req.roll_number, "Roll number")?,
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
            load_user(conn, &student_id.to_string()).map(Json)
        })
        .await
}

async fn delete_student(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(student_id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            let user = load_user(conn, &student_id.to_string())?;
            if user.role != Role::Student {
                return Err(HostError::BadRequest(
                    "Only student accounts can be removed here.".into(),
                ));
            }
            let tx = conn.transaction()?;
            let changed = tx.execute(
                "UPDATE users SET disabled_at = ?2 WHERE id = ?1 AND disabled_at IS NULL",
                rusqlite::params![student_id.to_string(), Utc::now().to_rfc3339()],
            )?;
            if changed == 0 {
                return Err(HostError::NotFound("student"));
            }
            tx.execute(
                "DELETE FROM sessions WHERE user_id = ?1",
                [student_id.to_string()],
            )?;
            tx.execute(
                "DELETE FROM classroom_enrolments WHERE student_id = ?1",
                [student_id.to_string()],
            )?;
            tx.commit()?;
            Ok(Json(serde_json::json!({ "ok": true })))
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
    validate_identity(username, display_name)?;

    let id = Uuid::new_v4();
    let now = Utc::now();
    let password_hash = if role == Role::Student && must_change_password {
        auth::hash_temporary_pin(password)?
    } else {
        auth::hash_password(password)?
    };
    let grade_level = clean_optional(grade_level, "Grade level")?;
    let section = clean_optional(section, "Section")?;
    let roll_number = clean_optional(roll_number, "Roll number")?;
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

fn random_pin() -> String {
    let mut bytes = [0u8; 2];
    OsRng.fill_bytes(&mut bytes);
    format!("{:04}", u16::from_le_bytes(bytes) % 10_000)
}

fn validate_identity(username: &str, display_name: &str) -> HostResult<()> {
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
    if username.chars().count() > 64 {
        return Err(HostError::BadRequest(
            "Username must be 64 characters or fewer.".into(),
        ));
    }
    if display_name.chars().count() > 120 {
        return Err(HostError::BadRequest(
            "Name must be 120 characters or fewer.".into(),
        ));
    }
    Ok(())
}

fn clean_optional(value: Option<String>, label: &str) -> HostResult<Option<String>> {
    let value = value
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty());
    if value
        .as_deref()
        .is_some_and(|item| item.chars().count() > 80)
    {
        return Err(HostError::BadRequest(format!(
            "{label} must be 80 characters or fewer."
        )));
    }
    Ok(value)
}

fn parse_uuid(value: &str, what: &str) -> HostResult<Uuid> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad {what} id: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{random_code, random_pin};

    #[test]
    fn recovery_code_is_readable() {
        let code = random_code(20);
        assert_eq!(code.len(), 20);
        assert!(code
            .chars()
            .all(|character| character.is_ascii_alphanumeric()));
    }

    #[test]
    fn temporary_pin_is_four_digits() {
        let pin = random_pin();
        assert_eq!(pin.len(), 4);
        assert!(pin.chars().all(|character| character.is_ascii_digit()));
    }
}
