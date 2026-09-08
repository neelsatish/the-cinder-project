//! Temporary classroom module sessions controlled by an assigned teacher.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use cinder_core::{
    JoinLiveSessionRequest, LiveSession, LiveSessionDetails, LiveSessionParticipant,
    LiveSessionResult, StartLiveSessionRequest, SubmitLiveSessionResultRequest,
};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::routes::assignments::assert_enrolled;
use crate::routes::classrooms::require_teacher_access;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/live-sessions", post(start))
        .route("/api/live-sessions/join", post(join))
        .route("/api/live-sessions/{id}", get(details))
        .route("/api/live-sessions/{id}/result", post(submit_result))
        .route("/api/live-sessions/{id}/end", post(end))
        .route(
            "/api/classrooms/{classroom_id}/live-session",
            get(active_for_classroom),
        )
}

async fn start(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Json(req): Json<StartLiveSessionRequest>,
) -> HostResult<Json<LiveSession>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            validate_module(&req.module_id, &req.module_name)?;
            if !(5..=30).contains(&req.duration_minutes) {
                return Err(HostError::BadRequest(
                    "Session duration must be between 5 and 30 minutes.".into(),
                ));
            }
            require_teacher_access(conn, req.classroom_id, teacher_id)?;

            let now = Utc::now();
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE live_module_sessions SET ended_at = ends_at
                  WHERE classroom_id = ?1 AND ended_at IS NULL
                    AND julianday(ends_at) <= julianday(?2)",
                rusqlite::params![req.classroom_id.to_string(), now.to_rfc3339()],
            )?;
            let already_active: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM live_module_sessions
                  WHERE classroom_id = ?1 AND ended_at IS NULL)",
                [req.classroom_id.to_string()],
                |row| row.get(0),
            )?;
            if already_active {
                return Err(HostError::Conflict);
            }

            let id = Uuid::new_v4();
            let ends_at = now + Duration::minutes(i64::from(req.duration_minutes));
            let join_code = random_join_code(&tx)?;
            tx.execute(
                "INSERT INTO live_module_sessions
                    (id, classroom_id, started_by, module_id, module_name, duration_minutes,
                     join_code, starts_at, ends_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    id.to_string(),
                    req.classroom_id.to_string(),
                    teacher_id.to_string(),
                    req.module_id.trim(),
                    req.module_name.trim(),
                    req.duration_minutes,
                    join_code,
                    now.to_rfc3339(),
                    ends_at.to_rfc3339(),
                ],
            )?;
            let session = load_session(&tx, id)?;
            tx.commit()?;
            Ok(Json(session))
        })
        .await
}

async fn active_for_classroom(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(classroom_id): Path<Uuid>,
) -> HostResult<Json<Option<LiveSession>>> {
    state
        .db(move |conn| {
            if user.0.role.is_teacher() {
                require_teacher_access(conn, classroom_id, user.id())?;
            } else {
                assert_enrolled(conn, classroom_id, user.id())?;
            }
            let now = Utc::now().to_rfc3339();
            let sql = if user.0.role.is_teacher() {
                "SELECT s.id, s.classroom_id, c.name, s.module_id, s.module_name,
                            s.duration_minutes, s.join_code, s.starts_at, s.ends_at, s.ended_at
                       FROM live_module_sessions s
                       JOIN classrooms c ON c.id = s.classroom_id
                      WHERE s.classroom_id = ?1 AND s.ended_at IS NULL
                        AND julianday(s.ends_at) > julianday(?2)
                        AND c.archived_at IS NULL"
            } else {
                "SELECT s.id, s.classroom_id, c.name, s.module_id, s.module_name,
                            s.duration_minutes, s.join_code, s.starts_at, s.ends_at, s.ended_at
                       FROM live_module_sessions s
                       JOIN classrooms c ON c.id = s.classroom_id
                       JOIN live_module_participants p ON p.session_id = s.id
                      WHERE s.classroom_id = ?1 AND s.ended_at IS NULL
                        AND julianday(s.ends_at) > julianday(?2)
                        AND c.archived_at IS NULL AND p.student_id = ?3"
            };
            let session = if user.0.role.is_teacher() {
                conn.query_row(
                    sql,
                    rusqlite::params![classroom_id.to_string(), now],
                    session_row,
                )
                .optional()?
                .transpose()?
            } else {
                conn.query_row(
                    sql,
                    rusqlite::params![classroom_id.to_string(), now, user.id().to_string()],
                    session_row,
                )
                .optional()?
                .transpose()?
            };
            Ok(Json(session))
        })
        .await
}

async fn join(
    State(state): State<AppState>,
    student: CurrentUser,
    Json(req): Json<JoinLiveSessionRequest>,
) -> HostResult<Json<LiveSession>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    let code = normalize_join_code(&req.code)?;
    state
        .db(move |conn| {
            let now = Utc::now();
            let session = conn
                .query_row(
                    "SELECT s.id, s.classroom_id, c.name, s.module_id, s.module_name,
                            s.duration_minutes, s.join_code, s.starts_at, s.ends_at, s.ended_at
                       FROM live_module_sessions s
                       JOIN classrooms c ON c.id = s.classroom_id
                      WHERE s.join_code = ?1 COLLATE NOCASE AND s.ended_at IS NULL
                        AND julianday(s.ends_at) > julianday(?2)
                        AND c.archived_at IS NULL",
                    rusqlite::params![code, now.to_rfc3339()],
                    session_row,
                )
                .optional()?
                .ok_or(HostError::NotFound("live session"))??;
            assert_enrolled(conn, session.classroom_id, student_id)?;
            conn.execute(
                "INSERT INTO live_module_participants (session_id, student_id, joined_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(session_id, student_id) DO NOTHING",
                rusqlite::params![
                    session.id.to_string(),
                    student_id.to_string(),
                    now.to_rfc3339(),
                ],
            )?;
            Ok(Json(session))
        })
        .await
}

async fn details(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<LiveSessionDetails>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let session = load_session(conn, id)?;
            require_teacher_access(conn, session.classroom_id, teacher_id)?;
            let mut stmt = conn.prepare(
                "SELECT p.student_id, u.display_name, p.joined_at,
                        r.score, r.elapsed_seconds, r.submitted_at
                   FROM live_module_participants p
                   JOIN users u ON u.id = p.student_id
                   LEFT JOIN live_module_results r
                     ON r.session_id = p.session_id AND r.student_id = p.student_id
                  WHERE p.session_id = ?1
                  ORDER BY lower(u.display_name)",
            )?;
            let participants = stmt
                .query_map([id.to_string()], participant_row)?
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(LiveSessionDetails {
                session,
                participants,
            }))
        })
        .await
}

async fn submit_result(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<SubmitLiveSessionResultRequest>,
) -> HostResult<Json<LiveSessionResult>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    if !req.score.is_finite() || !(0.0..=100.0).contains(&req.score) {
        return Err(HostError::BadRequest(
            "Score must be between 0 and 100.".into(),
        ));
    }
    let student_id = student.id();
    state
        .db(move |conn| {
            let session = load_session(conn, id)?;
            let now = Utc::now();
            if session.ended_at.is_some() || session.ends_at <= now {
                return Err(HostError::Conflict);
            }
            if req.elapsed_seconds > u32::from(session.duration_minutes) * 60 {
                return Err(HostError::BadRequest(
                    "Elapsed time cannot exceed the session duration.".into(),
                ));
            }
            let joined_and_enrolled: bool = conn.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM live_module_participants p
                    JOIN live_module_sessions s ON s.id = p.session_id
                    JOIN classrooms c ON c.id = s.classroom_id AND c.archived_at IS NULL
                    JOIN classroom_enrolments e
                      ON e.classroom_id = s.classroom_id AND e.student_id = p.student_id
                   WHERE p.session_id = ?1 AND p.student_id = ?2
                )",
                rusqlite::params![id.to_string(), student_id.to_string()],
                |row| row.get(0),
            )?;
            if !joined_and_enrolled {
                return Err(HostError::Forbidden);
            }
            let submitted_at = now.to_rfc3339();
            let inserted = conn.execute(
                "INSERT INTO live_module_results
                    (session_id, student_id, score, elapsed_seconds, submitted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(session_id, student_id) DO NOTHING",
                rusqlite::params![
                    id.to_string(),
                    student_id.to_string(),
                    req.score,
                    req.elapsed_seconds,
                    submitted_at,
                ],
            )?;
            if inserted == 0 {
                return Err(HostError::Conflict);
            }
            Ok(Json(LiveSessionResult {
                score: req.score,
                elapsed_seconds: req.elapsed_seconds,
                submitted_at: now,
            }))
        })
        .await
}

async fn end(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<LiveSession>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let session = load_session(conn, id)?;
            require_teacher_access(conn, session.classroom_id, teacher_id)?;
            conn.execute(
                "UPDATE live_module_sessions SET ended_at = coalesce(ended_at, ?2) WHERE id = ?1",
                rusqlite::params![id.to_string(), Utc::now().to_rfc3339()],
            )?;
            load_session(conn, id).map(Json)
        })
        .await
}

fn load_session(conn: &rusqlite::Connection, id: Uuid) -> HostResult<LiveSession> {
    conn.query_row(
        "SELECT s.id, s.classroom_id, c.name, s.module_id, s.module_name,
                s.duration_minutes, s.join_code, s.starts_at, s.ends_at, s.ended_at
           FROM live_module_sessions s JOIN classrooms c ON c.id = s.classroom_id
          WHERE s.id = ?1",
        [id.to_string()],
        session_row,
    )
    .optional()?
    .ok_or(HostError::NotFound("live session"))?
}

fn session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HostResult<LiveSession>> {
    let id: String = row.get(0)?;
    let classroom_id: String = row.get(1)?;
    let duration: i64 = row.get(5)?;
    let starts_at: String = row.get(7)?;
    let ends_at: String = row.get(8)?;
    let ended_at: Option<String> = row.get(9)?;
    Ok((|| {
        Ok(LiveSession {
            id: parse_uuid(&id, "live session")?,
            classroom_id: parse_uuid(&classroom_id, "classroom")?,
            classroom_name: row.get(2)?,
            module_id: row.get(3)?,
            module_name: row.get(4)?,
            duration_minutes: duration.try_into().map_err(|error| {
                HostError::Other(anyhow::anyhow!("bad session duration: {error}"))
            })?,
            join_code: row.get(6)?,
            starts_at: parse_time(&starts_at)?,
            ends_at: parse_time(&ends_at)?,
            ended_at: ended_at.map(|value| parse_time(&value)).transpose()?,
        })
    })())
}

fn participant_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<HostResult<LiveSessionParticipant>> {
    let student_id: String = row.get(0)?;
    let joined_at: String = row.get(2)?;
    let score: Option<f64> = row.get(3)?;
    let elapsed_seconds: Option<i64> = row.get(4)?;
    let submitted_at: Option<String> = row.get(5)?;
    Ok((|| {
        let result = match (score, elapsed_seconds, submitted_at) {
            (Some(score), Some(elapsed), Some(submitted)) => Some(LiveSessionResult {
                score,
                elapsed_seconds: elapsed.try_into().map_err(|error| {
                    HostError::Other(anyhow::anyhow!("bad elapsed time: {error}"))
                })?,
                submitted_at: parse_time(&submitted)?,
            }),
            (None, None, None) => None,
            _ => {
                return Err(HostError::Other(anyhow::anyhow!(
                    "incomplete live session result"
                )))
            }
        };
        Ok(LiveSessionParticipant {
            student_id: parse_uuid(&student_id, "student")?,
            student_name: row.get(1)?,
            joined_at: parse_time(&joined_at)?,
            result,
        })
    })())
}

fn validate_module(id: &str, name: &str) -> HostResult<()> {
    if id.trim().is_empty() || id.chars().count() > 100 {
        return Err(HostError::BadRequest(
            "Module id must contain between 1 and 100 characters.".into(),
        ));
    }
    if name.trim().is_empty() || name.chars().count() > 200 {
        return Err(HostError::BadRequest(
            "Module name must contain between 1 and 200 characters.".into(),
        ));
    }
    Ok(())
}

fn normalize_join_code(raw: &str) -> HostResult<String> {
    let code = raw.trim().to_ascii_uppercase();
    if code.len() == 10 && code.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        Ok(code)
    } else {
        Err(HostError::BadRequest(
            "Live session code must contain exactly ten letters or numbers.".into(),
        ))
    }
}

fn random_join_code(conn: &rusqlite::Connection) -> HostResult<String> {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for _ in 0..20 {
        let mut code = String::with_capacity(10);
        while code.len() < 10 {
            let mut byte = [0u8; 1];
            OsRng.fill_bytes(&mut byte);
            if byte[0] < 224 {
                code.push(ALPHABET[byte[0] as usize % ALPHABET.len()] as char);
            }
        }
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM live_module_sessions WHERE join_code = ?1 COLLATE NOCASE)",
            [&code],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(code);
        }
    }
    Err(HostError::Other(anyhow::anyhow!(
        "could not generate a unique live session code"
    )))
}

fn parse_uuid(value: &str, label: &'static str) -> HostResult<Uuid> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad {label} id: {error}")))
}

fn parse_time(value: &str) -> HostResult<DateTime<Utc>> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad timestamp: {error}")))
}

#[cfg(test)]
mod tests {
    use super::{active_for_classroom, details, end, join, start, submit_result};
    use crate::auth::CurrentUser;
    use crate::{db, AppState};
    use axum::extract::{Path, State};
    use axum::Json;
    use chrono::Utc;
    use cinder_ai::Ai;
    use cinder_core::{
        JoinLiveSessionRequest, Role, StartLiveSessionRequest, SubmitLiveSessionResultRequest, User,
    };
    use std::sync::Arc;
    use uuid::Uuid;

    #[tokio::test]
    async fn live_session_enforces_classroom_membership_and_single_results() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let owner = Uuid::new_v4();
        let co_teacher = Uuid::new_v4();
        let outsider_teacher = Uuid::new_v4();
        let student = Uuid::new_v4();
        let outsider_student = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let now = Utc::now();
        {
            let conn = pool.get().unwrap();
            for (id, username, role) in [
                (owner, "owner", "teacher"),
                (co_teacher, "co", "teacher"),
                (outsider_teacher, "other-teacher", "teacher"),
                (student, "student", "student"),
                (outsider_student, "other-student", "student"),
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
                    now.to_rfc3339()
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO classroom_enrolments (classroom_id, student_id, created_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![classroom.to_string(), student.to_string(), now.to_rfc3339()],
            )
            .unwrap();
        }
        let state = AppState {
            pool: pool.clone(),
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let current = |id: Uuid, username: &str, role: Role| {
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
        };
        let request = |duration_minutes| StartLiveSessionRequest {
            classroom_id: classroom,
            module_id: "typing.practice".into(),
            module_name: "Typing Practice".into(),
            duration_minutes,
        };

        let short = start(
            State(state.clone()),
            current(co_teacher, "co", Role::Teacher),
            Json(request(4)),
        )
        .await;
        assert!(matches!(short, Err(crate::error::HostError::BadRequest(_))));

        let inaccessible = start(
            State(state.clone()),
            current(outsider_teacher, "other-teacher", Role::Teacher),
            Json(request(10)),
        )
        .await;
        assert!(matches!(
            inaccessible,
            Err(crate::error::HostError::Forbidden)
        ));

        let Json(session) = start(
            State(state.clone()),
            current(co_teacher, "co", Role::Teacher),
            Json(request(10)),
        )
        .await
        .unwrap();
        assert_eq!(session.classroom_id, classroom);
        assert_eq!(session.join_code.len(), 10);
        assert_eq!(session.duration_minutes, 10);

        let duplicate = start(
            State(state.clone()),
            current(owner, "owner", Role::Teacher),
            Json(request(10)),
        )
        .await;
        assert!(matches!(duplicate, Err(crate::error::HostError::Conflict)));

        let Json(not_joined) = active_for_classroom(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(classroom),
        )
        .await
        .unwrap();
        assert!(not_joined.is_none(), "the join code must remain required");

        let rejected_join = join(
            State(state.clone()),
            current(outsider_student, "other-student", Role::Student),
            Json(JoinLiveSessionRequest {
                code: session.join_code.clone(),
            }),
        )
        .await;
        assert!(matches!(
            rejected_join,
            Err(crate::error::HostError::Forbidden)
        ));

        for _ in 0..2 {
            let _ = join(
                State(state.clone()),
                current(student, "student", Role::Student),
                Json(JoinLiveSessionRequest {
                    code: session.join_code.to_ascii_lowercase(),
                }),
            )
            .await
            .unwrap();
        }
        let participant_count: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM live_module_participants WHERE session_id = ?1",
                [session.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(participant_count, 1, "joining twice must not duplicate");

        let Json(active) = active_for_classroom(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(classroom),
        )
        .await
        .unwrap();
        assert_eq!(active.unwrap().id, session.id);

        let too_long = submit_result(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(session.id),
            Json(SubmitLiveSessionResultRequest {
                score: 90.0,
                elapsed_seconds: 601,
            }),
        )
        .await;
        assert!(matches!(
            too_long,
            Err(crate::error::HostError::BadRequest(_))
        ));

        let Json(result) = submit_result(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(session.id),
            Json(SubmitLiveSessionResultRequest {
                score: 90.0,
                elapsed_seconds: 420,
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.score, 90.0);

        let duplicate_result = submit_result(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(session.id),
            Json(SubmitLiveSessionResultRequest {
                score: 95.0,
                elapsed_seconds: 400,
            }),
        )
        .await;
        assert!(matches!(
            duplicate_result,
            Err(crate::error::HostError::Conflict)
        ));

        let Json(detail) = details(
            State(state.clone()),
            current(owner, "owner", Role::Teacher),
            Path(session.id),
        )
        .await
        .unwrap();
        assert_eq!(detail.participants.len(), 1);
        assert_eq!(detail.participants[0].result.as_ref().unwrap().score, 90.0);

        let outsider_detail = details(
            State(state.clone()),
            current(outsider_teacher, "other-teacher", Role::Teacher),
            Path(session.id),
        )
        .await;
        assert!(matches!(
            outsider_detail,
            Err(crate::error::HostError::Forbidden)
        ));

        let Json(ended) = end(
            State(state.clone()),
            current(co_teacher, "co", Role::Teacher),
            Path(session.id),
        )
        .await
        .unwrap();
        assert!(ended.ended_at.is_some());
        let Json(active) = active_for_classroom(
            State(state),
            current(student, "student", Role::Student),
            Path(classroom),
        )
        .await
        .unwrap();
        assert!(active.is_none());
    }
}
