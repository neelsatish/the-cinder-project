//! Authentication, first-run setup, recovery, and teacher-managed students.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use cinder_core::{
    AppLoginRequest, BootstrapTeacherRequest, BootstrapTeacherResponse, ChangePasswordRequest,
    CreateStudentRequest, CreateStudentResponse, DeleteTeacherRequest, LoginResponse,
    RecoverTeacherRequest, RegisterTeacherRequest, Role, TeacherInvitePinResponse,
    UpdateStudentRequest, User,
};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior};
use uuid::Uuid;

use crate::auth::{self, CurrentUser};
use crate::error::{HostError, HostResult};
use crate::routes::classrooms::require_teacher_access;
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
        .route("/api/teacher/invite-pin", post(generate_teacher_invite))
        .route("/api/teacher/accounts", get(list_teachers))
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

const PIN_LIFETIME_MINUTES: i64 = 15;
const PIN_BLOCK_MINUTES: i64 = 5;
const MAX_PIN_ATTEMPTS: i64 = 5;

/// Creates the setup PIN printed by the standalone host. Calling this on a
/// restart rotates the PIN so the host never has to retain its plaintext.
pub fn prepare_bootstrap_pin(pool: &crate::db::Pool) -> anyhow::Result<Option<String>> {
    let conn = pool.get()?;
    let active_teachers: i64 = conn.query_row(
        "SELECT count(*) FROM users WHERE role = 'teacher' AND disabled_at IS NULL",
        [],
        |row| row.get(0),
    )?;
    if active_teachers > 0 {
        conn.execute("DELETE FROM school_bootstrap_pin", [])?;
        return Ok(None);
    }

    let pin = random_numeric_pin(8);
    let expires_at = Utc::now() + Duration::minutes(PIN_LIFETIME_MINUTES);
    conn.execute(
        "INSERT INTO school_bootstrap_pin
            (singleton, pin_hash, expires_at, failed_attempts, blocked_until)
         VALUES (1, ?1, ?2, 0, NULL)
         ON CONFLICT(singleton) DO UPDATE SET
            pin_hash = excluded.pin_hash,
            expires_at = excluded.expires_at,
            failed_attempts = 0,
            blocked_until = NULL",
        rusqlite::params![auth::hash_one_time_pin(&pin)?, expires_at.to_rfc3339()],
    )?;
    Ok(Some(pin))
}

async fn status(State(state): State<AppState>) -> HostResult<Json<serde_json::Value>> {
    state
        .db(|conn| {
            let active_teachers: i64 = conn.query_row(
                "SELECT count(*) FROM users WHERE role = 'teacher' AND disabled_at IS NULL",
                [],
                |row| row.get(0),
            )?;
            Ok(Json(
                serde_json::json!({ "needs_setup": active_teachers == 0 }),
            ))
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
    Json(req): Json<BootstrapTeacherRequest>,
) -> HostResult<Json<BootstrapTeacherResponse>> {
    state
        .db(move |conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let active_teachers: i64 = tx.query_row(
                "SELECT count(*) FROM users WHERE role = 'teacher' AND disabled_at IS NULL",
                [],
                |row| row.get(0),
            )?;
            if active_teachers > 0 {
                return Err(HostError::Forbidden);
            }
            let result =
                verify_limited_pin(&tx, "school_bootstrap_pin", &req.bootstrap_pin, Utc::now());
            if let Err(error) = result {
                tx.commit()?;
                return Err(error);
            }

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
            tx.execute(
                "UPDATE classrooms
                    SET owner_teacher_id = ?1
                  WHERE NOT EXISTS (
                        SELECT 1 FROM users owner
                         WHERE owner.id = classrooms.owner_teacher_id
                           AND owner.role = 'teacher'
                           AND owner.disabled_at IS NULL
                  )",
                [user.id.to_string()],
            )?;
            tx.execute("DELETE FROM school_bootstrap_pin", [])?;
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
            if req.password.len() < 8 {
                return Err(HostError::BadRequest("Use at least 8 characters for the password.".into()));
            }

            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let result = verify_limited_pin(
                &tx,
                "teacher_invite_pin",
                &req.invite_pin,
                Utc::now(),
            );
            if let Err(error) = result {
                tx.commit()?;
                return Err(error);
            }
            let creator_is_active: bool = tx.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM teacher_invite_pin invite
                    JOIN users creator ON creator.id = invite.created_by
                    WHERE invite.singleton = 1
                      AND creator.role = 'teacher'
                      AND creator.disabled_at IS NULL
                )",
                [],
                |row| row.get(0),
            )?;
            if !creator_is_active {
                tx.execute("DELETE FROM teacher_invite_pin", [])?;
                tx.commit()?;
                return Err(HostError::BadCredentials);
            }
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
            tx.execute("DELETE FROM teacher_invite_pin", [])?;
            tx.commit()?;
            Ok(Json(BootstrapTeacherResponse { user, recovery_code }))
        })
        .await
}

async fn generate_teacher_invite(
    State(state): State<AppState>,
    teacher: CurrentUser,
) -> HostResult<Json<TeacherInvitePinResponse>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let invite_pin = random_numeric_pin(8);
            let expires_at = Utc::now() + Duration::minutes(PIN_LIFETIME_MINUTES);
            conn.execute(
                "INSERT INTO teacher_invite_pin
                    (singleton, pin_hash, created_by, expires_at, failed_attempts, blocked_until)
                 VALUES (1, ?1, ?2, ?3, 0, NULL)
                 ON CONFLICT(singleton) DO UPDATE SET
                    pin_hash = excluded.pin_hash,
                    created_by = excluded.created_by,
                    expires_at = excluded.expires_at,
                    failed_attempts = 0,
                    blocked_until = NULL",
                rusqlite::params![
                    auth::hash_one_time_pin(&invite_pin)?,
                    teacher_id.to_string(),
                    expires_at.to_rfc3339(),
                ],
            )?;
            Ok(Json(TeacherInvitePinResponse {
                invite_pin,
                expires_at,
            }))
        })
        .await
}

fn verify_limited_pin(
    tx: &Transaction<'_>,
    table: &'static str,
    submitted: &str,
    now: chrono::DateTime<Utc>,
) -> HostResult<()> {
    debug_assert!(matches!(
        table,
        "school_bootstrap_pin" | "teacher_invite_pin"
    ));
    let sql = format!(
        "SELECT pin_hash, expires_at, failed_attempts, blocked_until FROM {table} WHERE singleton = 1"
    );
    let row = tx
        .query_row(&sql, [], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .optional()?;
    let Some((pin_hash, expires_at, attempts, blocked_until)) = row else {
        let _ = auth::verify_password(DUMMY_HASH, submitted);
        return Err(HostError::BadCredentials);
    };
    let expires_at = expires_at
        .parse::<chrono::DateTime<Utc>>()
        .map_err(|error| {
            HostError::Other(anyhow::anyhow!("bad PIN expiry in database: {error}"))
        })?;
    let blocked_until = blocked_until
        .map(|value| value.parse::<chrono::DateTime<Utc>>())
        .transpose()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad PIN block time: {error}")))?;
    if blocked_until.is_some_and(|until| until > now) {
        return Err(HostError::RateLimited);
    }
    if expires_at <= now {
        return Err(HostError::BadCredentials);
    }
    if submitted.len() == 8
        && submitted.bytes().all(|byte| byte.is_ascii_digit())
        && auth::verify_password(&pin_hash, submitted)
    {
        return Ok(());
    }

    let next_attempts = attempts + 1;
    let (stored_attempts, next_block, error) = if next_attempts >= MAX_PIN_ATTEMPTS {
        (
            0,
            Some((now + Duration::minutes(PIN_BLOCK_MINUTES)).to_rfc3339()),
            HostError::RateLimited,
        )
    } else {
        (next_attempts, None, HostError::BadCredentials)
    };
    tx.execute(
        &format!("UPDATE {table} SET failed_attempts = ?1, blocked_until = ?2 WHERE singleton = 1"),
        rusqlite::params![stored_attempts, next_block],
    )?;
    Err(error)
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

async fn delete_teacher(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(teacher_id): Path<Uuid>,
    Json(req): Json<DeleteTeacherRequest>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    let actor_id = teacher.id().to_string();
    if teacher_id.to_string() != actor_id {
        return Err(HostError::Forbidden);
    }
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

            let owned_classrooms: i64 = conn.query_row(
                "SELECT count(*) FROM classrooms WHERE owner_teacher_id = ?1",
                [&actor_id],
                |row| row.get(0),
            )?;
            if owned_classrooms > 0 {
                return Err(HostError::BadRequest(
                    "Archive history still belongs to this teacher. Classroom ownership must be resolved before disabling the account.".into(),
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
            tx.execute(
                "DELETE FROM teacher_invite_pin WHERE created_by = ?1",
                [&target_id],
            )?;
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
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let temporary_password = random_pin();
            let recovery_code = random_code(20);
            let tx = conn.transaction()?;
            require_teacher_access(&tx, req.classroom_id, teacher_id)?;
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
            tx.execute(
                "INSERT INTO classroom_enrolments (classroom_id, student_id, created_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    req.classroom_id.to_string(),
                    user.id.to_string(),
                    Utc::now().to_rfc3339()
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
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let tx = conn.transaction()?;
            require_student_management_access(&tx, student_id, teacher_id)?;
            let user = load_user(&tx, &student_id.to_string())?;
            if user.role != Role::Student {
                return Err(HostError::BadRequest(
                    "Only student credentials can be reset here.".into(),
                ));
            }
            let temporary_password = random_pin();
            let recovery_code = random_code(20);
            let now = Utc::now().to_rfc3339();
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
            let user = load_user(&tx, &student_id.to_string())?;
            tx.commit()?;
            Ok(Json(CreateStudentResponse {
                user,
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
                      WHERE lower(u.username) = lower(?1) AND u.role = 'teacher'
                        AND u.disabled_at IS NULL",
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
    let teacher_id = teacher.id().to_string();
    state
        .db(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT u.id
                   FROM users u
                  WHERE u.role = 'student' AND u.disabled_at IS NULL
                    AND EXISTS(
                        SELECT 1
                          FROM classroom_enrolments e
                          JOIN classrooms c ON c.id = e.classroom_id
                         WHERE e.student_id = u.id AND c.archived_at IS NULL
                           AND (c.owner_teacher_id = ?1 OR EXISTS(
                               SELECT 1 FROM classroom_teachers ct
                                WHERE ct.classroom_id = c.id AND ct.teacher_id = ?1
                           ))
                    )
                  ORDER BY lower(u.display_name)",
            )?;
            let ids = stmt
                .query_map([teacher_id], |row| row.get::<_, String>(0))?
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
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let tx = conn.transaction()?;
            require_student_management_access(&tx, student_id, teacher_id)?;
            let existing = load_user(&tx, &student_id.to_string())?;
            if existing.role != Role::Student {
                return Err(HostError::BadRequest("Only student accounts can be edited here.".into()));
            }
            let username = req.username.trim();
            let display_name = req.display_name.trim();
            validate_identity(username, display_name)?;
            tx.execute(
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
            let user = load_user(&tx, &student_id.to_string())?;
            tx.commit()?;
            Ok(Json(user))
        })
        .await
}

async fn delete_student(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(student_id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let tx = conn.transaction()?;
            require_student_management_access(&tx, student_id, teacher_id)?;
            let user = load_user(&tx, &student_id.to_string())?;
            if user.role != Role::Student {
                return Err(HostError::BadRequest(
                    "Only student accounts can be removed here.".into(),
                ));
            }
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

fn require_student_management_access(
    conn: &rusqlite::Connection,
    student_id: Uuid,
    teacher_id: Uuid,
) -> HostResult<()> {
    let (has_accessible_class, has_inaccessible_class): (bool, bool) = conn.query_row(
        "SELECT
            EXISTS(
                SELECT 1
                  FROM classroom_enrolments e
                  JOIN classrooms c ON c.id = e.classroom_id
                 WHERE e.student_id = ?1 AND c.archived_at IS NULL
                   AND (c.owner_teacher_id = ?2 OR EXISTS(
                       SELECT 1 FROM classroom_teachers ct
                        WHERE ct.classroom_id = c.id AND ct.teacher_id = ?2
                   ))
            ),
            EXISTS(
                SELECT 1
                  FROM classroom_enrolments e
                  JOIN classrooms c ON c.id = e.classroom_id
                 WHERE e.student_id = ?1 AND c.archived_at IS NULL
                   AND NOT (c.owner_teacher_id = ?2 OR EXISTS(
                       SELECT 1 FROM classroom_teachers ct
                        WHERE ct.classroom_id = c.id AND ct.teacher_id = ?2
                   ))
            )",
        rusqlite::params![student_id.to_string(), teacher_id.to_string()],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if has_accessible_class && !has_inaccessible_class {
        Ok(())
    } else {
        Err(HostError::Forbidden)
    }
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
    random_numeric_pin(4)
}

fn random_numeric_pin(length: usize) -> String {
    let mut pin = String::with_capacity(length);
    while pin.len() < length {
        let mut byte = [0u8; 1];
        OsRng.fill_bytes(&mut byte);
        if byte[0] < 250 {
            pin.push(char::from(b'0' + byte[0] % 10));
        }
    }
    pin
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
    use super::{
        bootstrap, create_student, delete_student, delete_teacher, list_users,
        prepare_bootstrap_pin, random_code, random_pin, recover_teacher, register_teacher,
        reset_student_credentials, update_student, verify_limited_pin, BootstrapTeacherResponse,
        RegisterTeacherRequest, MAX_PIN_ATTEMPTS,
    };
    use crate::auth::CurrentUser;
    use crate::{db, AppState};
    use axum::{
        body::Body,
        extract::{Path, State},
        http::{Method, Request, StatusCode},
        Json,
    };
    use chrono::Utc;
    use cinder_ai::Ai;
    use cinder_core::{
        BootstrapTeacherRequest, CreateStudentRequest, DeleteTeacherRequest, RecoverTeacherRequest,
        Role, UpdateStudentRequest, User,
    };
    use std::sync::Arc;
    use tower::ServiceExt;
    use uuid::Uuid;

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

    #[tokio::test]
    async fn student_administration_is_scoped_to_the_teachers_active_classrooms() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let actor = Uuid::new_v4();
        let other = Uuid::new_v4();
        let owned_room = Uuid::new_v4();
        let co_taught_room = Uuid::new_v4();
        let other_room = Uuid::new_v4();
        let owned_student = Uuid::new_v4();
        let co_taught_student = Uuid::new_v4();
        let mixed_student = Uuid::new_v4();
        let outside_student = Uuid::new_v4();
        let now = Utc::now();
        {
            let conn = pool.get().unwrap();
            for (id, username, role) in [
                (actor, "actor", "teacher"),
                (other, "other", "teacher"),
                (owned_student, "owned", "student"),
                (co_taught_student, "co-taught", "student"),
                (mixed_student, "mixed", "student"),
                (outside_student, "outside", "student"),
            ] {
                conn.execute(
                    "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                     VALUES (?1, ?2, ?2, 'hash', ?3, ?4)",
                    rusqlite::params![id.to_string(), username, role, now.to_rfc3339()],
                )
                .unwrap();
            }
            for (id, name, owner, code) in [
                (owned_room, "Owned", actor, "OWNED001"),
                (co_taught_room, "Co-taught", other, "COTEACH1"),
                (other_room, "Other", other, "OTHER001"),
            ] {
                conn.execute(
                    "INSERT INTO classrooms
                        (id, name, description, color, created_at, owner_teacher_id, enrolment_code)
                     VALUES (?1, ?2, '', '#BEC2FF', ?3, ?4, ?5)",
                    rusqlite::params![
                        id.to_string(),
                        name,
                        now.to_rfc3339(),
                        owner.to_string(),
                        code
                    ],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO classroom_teachers
                    (classroom_id, teacher_id, added_by, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    co_taught_room.to_string(),
                    actor.to_string(),
                    other.to_string(),
                    now.to_rfc3339()
                ],
            )
            .unwrap();
            for (room, student) in [
                (owned_room, owned_student),
                (co_taught_room, co_taught_student),
                (owned_room, mixed_student),
                (other_room, mixed_student),
                (other_room, outside_student),
            ] {
                conn.execute(
                    "INSERT INTO classroom_enrolments (classroom_id, student_id, created_at)
                     VALUES (?1, ?2, ?3)",
                    rusqlite::params![room.to_string(), student.to_string(), now.to_rfc3339()],
                )
                .unwrap();
            }
        }
        let state = AppState {
            pool: pool.clone(),
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let current = CurrentUser(
            User {
                id: actor,
                username: "actor".into(),
                display_name: "Actor".into(),
                role: Role::Teacher,
                grade_level: None,
                section: None,
                roll_number: None,
                must_change_password: false,
                created_at: now,
            },
            "token".into(),
        );

        let Json(visible) = list_users(State(state.clone()), current.clone())
            .await
            .unwrap();
        let visible_ids = visible.iter().map(|user| user.id).collect::<Vec<_>>();
        assert!(visible_ids.contains(&owned_student));
        assert!(visible_ids.contains(&co_taught_student));
        assert!(visible_ids.contains(&mixed_student));
        assert!(!visible_ids.contains(&outside_student));

        let update = |username: &str| UpdateStudentRequest {
            username: username.into(),
            display_name: username.into(),
            grade_level: None,
            section: None,
            roll_number: None,
        };
        let _ = update_student(
            State(state.clone()),
            current.clone(),
            Path(owned_student),
            Json(update("owned-updated")),
        )
        .await
        .unwrap();
        assert!(matches!(
            update_student(
                State(state.clone()),
                current.clone(),
                Path(mixed_student),
                Json(update("mixed-updated")),
            )
            .await,
            Err(crate::error::HostError::Forbidden)
        ));
        assert!(matches!(
            update_student(
                State(state.clone()),
                current.clone(),
                Path(outside_student),
                Json(update("outside-updated")),
            )
            .await,
            Err(crate::error::HostError::Forbidden)
        ));

        let _ = reset_student_credentials(
            State(state.clone()),
            current.clone(),
            Path(co_taught_student),
        )
        .await
        .unwrap();
        assert!(matches!(
            reset_student_credentials(State(state.clone()), current.clone(), Path(mixed_student),)
                .await,
            Err(crate::error::HostError::Forbidden)
        ));
        assert!(matches!(
            delete_student(State(state.clone()), current.clone(), Path(mixed_student),).await,
            Err(crate::error::HostError::Forbidden)
        ));

        let Json(created) = create_student(
            State(state.clone()),
            current.clone(),
            Json(CreateStudentRequest {
                classroom_id: co_taught_room,
                username: "new-student".into(),
                display_name: "New Student".into(),
                grade_level: None,
                section: None,
                roll_number: None,
            }),
        )
        .await
        .unwrap();
        let enrolled: bool = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM classroom_enrolments
                  WHERE classroom_id = ?1 AND student_id = ?2)",
                rusqlite::params![co_taught_room.to_string(), created.user.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(enrolled);
        assert!(matches!(
            create_student(
                State(state.clone()),
                current.clone(),
                Json(CreateStudentRequest {
                    classroom_id: other_room,
                    username: "forbidden-student".into(),
                    display_name: "Forbidden Student".into(),
                    grade_level: None,
                    section: None,
                    roll_number: None,
                }),
            )
            .await,
            Err(crate::error::HostError::Forbidden)
        ));

        let _ = delete_student(State(state), current, Path(owned_student))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn disabled_teacher_cannot_recover_an_account() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let teacher = Uuid::new_v4();
        let now = Utc::now();
        let old_password_hash = crate::auth::hash_password("old-password").unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users
                    (id, username, display_name, pw_hash, role, created_at, disabled_at)
                 VALUES (?1, 'disabled-teacher', 'Disabled', ?2, 'teacher', ?3, ?3)",
                rusqlite::params![teacher.to_string(), old_password_hash, now.to_rfc3339()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO teacher_recovery (user_id, recovery_hash, created_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    teacher.to_string(),
                    crate::auth::hash_password("RecoveryCode123").unwrap(),
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
        let result = recover_teacher(
            State(state),
            Json(RecoverTeacherRequest {
                username: "disabled-teacher".into(),
                recovery_code: "RecoveryCode123".into(),
                new_password: "new-password".into(),
            }),
        )
        .await;
        assert!(matches!(
            result,
            Err(crate::error::HostError::BadCredentials)
        ));
    }

    #[test]
    fn bootstrap_pin_is_hashed_and_throttled() {
        let pool = db::open_in_memory().unwrap();
        let pin = prepare_bootstrap_pin(&pool).unwrap().unwrap();
        let mut conn = pool.get().unwrap();
        let stored: String = conn
            .query_row(
                "SELECT pin_hash FROM school_bootstrap_pin WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(stored, pin);
        assert!(!stored.contains(&pin));

        for attempt in 1..=MAX_PIN_ATTEMPTS {
            let tx = conn.transaction().unwrap();
            let result = verify_limited_pin(&tx, "school_bootstrap_pin", "00000000", Utc::now());
            tx.commit().unwrap();
            if attempt < MAX_PIN_ATTEMPTS {
                assert!(matches!(
                    result,
                    Err(crate::error::HostError::BadCredentials)
                ));
            } else {
                assert!(matches!(result, Err(crate::error::HostError::RateLimited)));
            }
        }
        let tx = conn.transaction().unwrap();
        let result = verify_limited_pin(&tx, "school_bootstrap_pin", &pin, Utc::now());
        tx.commit().unwrap();
        assert!(matches!(result, Err(crate::error::HostError::RateLimited)));
    }

    #[tokio::test]
    async fn bootstrap_requires_the_host_pin_and_recovers_a_database_without_active_teachers() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let disabled_teacher = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let now = Utc::now();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users
                    (id, username, display_name, pw_hash, role, created_at, disabled_at)
                 VALUES (?1, 'old-teacher', 'Old Teacher', 'hash', 'teacher', ?2, ?2)",
                rusqlite::params![disabled_teacher.to_string(), now.to_rfc3339()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                 VALUES (?1, 'student', 'Student', 'hash', 'student', ?2)",
                rusqlite::params![Uuid::new_v4().to_string(), now.to_rfc3339()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO classrooms
                    (id, name, description, color, created_at, owner_teacher_id, enrolment_code)
                 VALUES (?1, 'Legacy', '', '#BEC2FF', ?2, ?3, 'ABCDEFGH')",
                rusqlite::params![
                    classroom.to_string(),
                    now.to_rfc3339(),
                    disabled_teacher.to_string()
                ],
            )
            .unwrap();
        }
        let pin = prepare_bootstrap_pin(&pool).unwrap().unwrap();
        let state = AppState {
            pool: pool.clone(),
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };

        let rejected = bootstrap(
            State(state.clone()),
            Json(BootstrapTeacherRequest {
                username: "replacement".into(),
                display_name: "Replacement".into(),
                password: "password123".into(),
                bootstrap_pin: String::new(),
            }),
        )
        .await;
        assert!(matches!(
            rejected,
            Err(crate::error::HostError::BadCredentials)
        ));

        let Json(created) = bootstrap(
            State(state),
            Json(BootstrapTeacherRequest {
                username: "replacement".into(),
                display_name: "Replacement".into(),
                password: "password123".into(),
                bootstrap_pin: pin,
            }),
        )
        .await
        .unwrap();
        let conn = pool.get().unwrap();
        let owner: String = conn
            .query_row(
                "SELECT owner_teacher_id FROM classrooms WHERE id = ?1",
                [classroom.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner, created.user.id.to_string());
    }

    #[tokio::test]
    async fn teacher_invite_is_single_use_and_recovery_code_does_not_register() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let state = AppState {
            pool: pool.clone(),
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let teacher_id = uuid::Uuid::new_v4();
        let recovery_code = "RecoveryCode12345678";
        let invite_pin = "12345678";
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                 VALUES (?1, 'owner', 'Owner', ?2, 'teacher', ?3)",
                rusqlite::params![
                    teacher_id.to_string(),
                    crate::auth::hash_password("password123").unwrap(),
                    Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO teacher_recovery (user_id, recovery_hash, created_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    teacher_id.to_string(),
                    crate::auth::hash_password(recovery_code).unwrap(),
                    Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO teacher_invite_pin
                    (singleton, pin_hash, created_by, expires_at, failed_attempts)
                 VALUES (1, ?1, ?2, ?3, 0)",
                rusqlite::params![
                    crate::auth::hash_one_time_pin(invite_pin).unwrap(),
                    teacher_id.to_string(),
                    (Utc::now() + chrono::Duration::minutes(15)).to_rfc3339(),
                ],
            )
            .unwrap();
        }

        let rejected = register_teacher(
            State(state.clone()),
            Json(RegisterTeacherRequest {
                username: "recovery-misuse".into(),
                display_name: "Recovery Misuse".into(),
                password: "password123".into(),
                invite_pin: recovery_code.into(),
            }),
        )
        .await;
        assert!(matches!(
            rejected,
            Err(crate::error::HostError::BadCredentials)
        ));

        let Json(BootstrapTeacherResponse { user, .. }) = register_teacher(
            State(state.clone()),
            Json(RegisterTeacherRequest {
                username: "second".into(),
                display_name: "Second Teacher".into(),
                password: "password123".into(),
                invite_pin: invite_pin.into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(user.username, "second");

        let reused = register_teacher(
            State(state),
            Json(RegisterTeacherRequest {
                username: "third".into(),
                display_name: "Third Teacher".into(),
                password: "password123".into(),
                invite_pin: invite_pin.into(),
            }),
        )
        .await;
        assert!(matches!(
            reused,
            Err(crate::error::HostError::BadCredentials)
        ));
    }

    #[tokio::test]
    async fn disabled_inviter_cannot_authorize_registration() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let inviter = Uuid::new_v4();
        let pin = "12345678";
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO users
                    (id, username, display_name, pw_hash, role, created_at, disabled_at)
                 VALUES (?1, 'disabled', 'Disabled', 'hash', 'teacher', ?2, ?2)",
                rusqlite::params![inviter.to_string(), Utc::now().to_rfc3339()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO teacher_invite_pin
                    (singleton, pin_hash, created_by, expires_at, failed_attempts)
                 VALUES (1, ?1, ?2, ?3, 0)",
                rusqlite::params![
                    crate::auth::hash_one_time_pin(pin).unwrap(),
                    inviter.to_string(),
                    (Utc::now() + chrono::Duration::minutes(15)).to_rfc3339(),
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
        let result = register_teacher(
            State(state),
            Json(RegisterTeacherRequest {
                username: "new-teacher".into(),
                display_name: "New Teacher".into(),
                password: "password123".into(),
                invite_pin: pin.into(),
            }),
        )
        .await;
        assert!(matches!(
            result,
            Err(crate::error::HostError::BadCredentials)
        ));
        let conn = pool.get().unwrap();
        let invites: i64 = conn
            .query_row("SELECT count(*) FROM teacher_invite_pin", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(invites, 0);
    }

    #[tokio::test]
    async fn authenticated_teacher_account_post_is_not_a_registration_path() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let state = AppState {
            pool,
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let response = crate::router(state)
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/teacher/accounts")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn teacher_may_only_disable_self_without_owned_classrooms() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let actor = Uuid::new_v4();
        let other = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let now = Utc::now();
        let password = "password123";
        {
            let conn = pool.get().unwrap();
            for (id, username) in [(actor, "actor"), (other, "other")] {
                conn.execute(
                    "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                     VALUES (?1, ?2, ?2, ?3, 'teacher', ?4)",
                    rusqlite::params![
                        id.to_string(),
                        username,
                        crate::auth::hash_password(password).unwrap(),
                        now.to_rfc3339()
                    ],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO classrooms
                    (id, name, description, color, created_at, archived_at,
                     owner_teacher_id, enrolment_code)
                 VALUES (?1, 'Archived', '', '#BEC2FF', ?2, ?2, ?3, 'ABCDEFGH')",
                rusqlite::params![classroom.to_string(), now.to_rfc3339(), actor.to_string()],
            )
            .unwrap();
        }
        let state = AppState {
            pool: pool.clone(),
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let current = CurrentUser(
            User {
                id: actor,
                username: "actor".into(),
                display_name: "Actor".into(),
                role: Role::Teacher,
                grade_level: None,
                section: None,
                roll_number: None,
                must_change_password: false,
                created_at: now,
            },
            "token".into(),
        );

        let other_result = delete_teacher(
            State(state.clone()),
            current.clone(),
            Path(other),
            Json(DeleteTeacherRequest {
                current_password: password.into(),
            }),
        )
        .await;
        assert!(matches!(
            other_result,
            Err(crate::error::HostError::Forbidden)
        ));

        let owned_result = delete_teacher(
            State(state.clone()),
            current.clone(),
            Path(actor),
            Json(DeleteTeacherRequest {
                current_password: password.into(),
            }),
        )
        .await;
        assert!(matches!(
            owned_result,
            Err(crate::error::HostError::BadRequest(_))
        ));

        pool.get()
            .unwrap()
            .execute(
                "DELETE FROM classrooms WHERE id = ?1",
                [classroom.to_string()],
            )
            .unwrap();
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO teacher_invite_pin
                    (singleton, pin_hash, created_by, expires_at, failed_attempts)
                 VALUES (1, ?1, ?2, ?3, 0)",
                rusqlite::params![
                    crate::auth::hash_one_time_pin("87654321").unwrap(),
                    actor.to_string(),
                    (Utc::now() + chrono::Duration::minutes(15)).to_rfc3339()
                ],
            )
            .unwrap();
        let Json(result) = delete_teacher(
            State(state),
            current,
            Path(actor),
            Json(DeleteTeacherRequest {
                current_password: password.into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(result["deleted_current"], true);
        let invites: i64 = pool
            .get()
            .unwrap()
            .query_row("SELECT count(*) FROM teacher_invite_pin", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(invites, 0);
    }
}
