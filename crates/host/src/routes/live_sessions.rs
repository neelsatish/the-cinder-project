//! Temporary classroom module sessions controlled by an assigned teacher.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use cinder_core::{
    AcknowledgeLiveSessionTaskRequest, AssignLiveSessionTaskRequest, JoinLiveSessionRequest,
    LiveSession, LiveSessionDetails, LiveSessionHistoryItem, LiveSessionParticipant,
    LiveSessionResult, LiveSessionTask, LiveSessionTaskAcknowledgement, LiveSessionTaskKind,
    LiveSessionTaskParticipantProgress, LiveSessionTaskProgress, LiveSessionTaskState,
    StartLiveSessionRequest, SubmitLiveSessionResultRequest,
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
        .route("/api/live-sessions/active", get(active_for_student))
        .route("/api/live-sessions/join", post(join))
        .route("/api/live-sessions/{id}/join", post(join_by_id))
        .route("/api/live-sessions/{id}", get(details))
        .route("/api/live-sessions/{id}/task", post(assign_task))
        .route("/api/live-sessions/{id}/task-ack", post(acknowledge_task))
        .route("/api/live-sessions/{id}/result", post(submit_result))
        .route("/api/live-sessions/{id}/end", post(end))
        .route(
            "/api/classrooms/{classroom_id}/live-session",
            get(active_for_classroom),
        )
        .route(
            "/api/classrooms/{classroom_id}/live-sessions",
            get(session_history),
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
            let session = with_task(&tx, session, None)?;
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
            let now = Utc::now().to_rfc3339();
            if user.0.role.is_teacher() {
                require_teacher_access(conn, classroom_id, user.id())?;
            } else {
                assert_enrolled(conn, classroom_id, user.id())?;
                conn.execute(
                    "UPDATE live_module_participants SET last_seen_at = ?3
                      WHERE session_id IN (SELECT id FROM live_module_sessions WHERE classroom_id = ?1 AND ended_at IS NULL)
                        AND student_id = ?2",
                    rusqlite::params![classroom_id.to_string(), user.id().to_string(), now.clone()],
                )?;
            }
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
                       WHERE s.classroom_id = ?1 AND s.ended_at IS NULL
                         AND julianday(s.ends_at) > julianday(?2)
                         AND c.archived_at IS NULL"
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
                    rusqlite::params![classroom_id.to_string(), now],
                    session_row,
                )
                .optional()?
                .transpose()?
            };
            Ok(Json(
                session
                    .map(|value| {
                        with_task(conn, value, (!user.0.role.is_teacher()).then(|| user.id()))
                    })
                    .transpose()?,
            ))
        })
        .await
}

async fn active_for_student(
    State(state): State<AppState>,
    student: CurrentUser,
) -> HostResult<Json<Vec<LiveSession>>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    state
        .db(move |conn| {
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE live_module_participants SET last_seen_at = ?2
                  WHERE student_id = ?1 AND session_id IN (
                    SELECT id FROM live_module_sessions WHERE ended_at IS NULL AND julianday(ends_at) > julianday(?2)
                  )",
                rusqlite::params![student_id.to_string(), now],
            )?;
            let mut stmt = conn.prepare(
                "SELECT s.id, s.classroom_id, c.name, s.module_id, s.module_name,
                        s.duration_minutes, s.join_code, s.starts_at, s.ends_at, s.ended_at
                   FROM live_module_sessions s
                   JOIN classrooms c ON c.id = s.classroom_id
                   JOIN classroom_enrolments e ON e.classroom_id = s.classroom_id
                  WHERE e.student_id = ?1 AND c.archived_at IS NULL
                    AND s.ended_at IS NULL AND julianday(s.ends_at) > julianday(?2)
                  ORDER BY s.starts_at DESC",
            )?;
            let sessions = stmt
                .query_map(rusqlite::params![student_id.to_string(), now], session_row)?
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .collect::<HostResult<Vec<_>>>()?
                .into_iter()
                .map(|session| with_task(conn, session, Some(student_id)))
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(sessions))
        })
        .await
}

async fn join_by_id(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<LiveSession>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    state
        .db(move |conn| {
            let session = load_session(conn, id)?;
            assert_enrolled(conn, session.classroom_id, student_id)?;
            let now = Utc::now();
            if session.ended_at.is_some() || session.ends_at <= now {
                return Err(HostError::Conflict);
            }
            conn.execute(
                "INSERT INTO live_module_participants (session_id, student_id, joined_at, last_seen_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(session_id, student_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
                rusqlite::params![id.to_string(), student_id.to_string(), now.to_rfc3339()],
            )?;
            Ok(Json(with_task(conn, session, Some(student_id))?))
        })
        .await
}

async fn assign_task(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<AssignLiveSessionTaskRequest>,
) -> HostResult<Json<LiveSessionTask>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let session = load_session(conn, id)?;
            require_teacher_access(conn, session.classroom_id, teacher_id)?;
            if session.ended_at.is_some() || session.ends_at <= Utc::now() {
                return Err(HostError::Conflict);
            }
            validate_task(conn, session.id, session.classroom_id, &req)?;
            let now = Utc::now();
            let tx = conn.transaction()?;
            let revision: i64 = tx.query_row(
                "SELECT coalesce(max(revision), 0) + 1 FROM live_session_tasks WHERE session_id = ?1",
                [id.to_string()],
                |row| row.get(0),
            )?;
            tx.execute(
                "INSERT INTO live_session_tasks
                    (id, session_id, revision, kind, target_id, title, instructions, assigned_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    Uuid::new_v4().to_string(), id.to_string(), revision, req.kind.as_str(),
                    req.target_id.map(|value| value.to_string()), req.title.trim(), req.instructions.trim(),
                    teacher_id.to_string(), now.to_rfc3339(),
                ],
            )?;
            let task = load_current_task(&tx, id, None)?.ok_or(HostError::NotFound("live task"))?.0;
            tx.commit()?;
            Ok(Json(task))
        })
        .await
}

async fn acknowledge_task(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<AcknowledgeLiveSessionTaskRequest>,
) -> HostResult<Json<LiveSessionTaskAcknowledgement>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    state
        .db(move |conn| {
            let session = load_session(conn, id)?;
            assert_enrolled(conn, session.classroom_id, student_id)?;
            if session.ended_at.is_some() || session.ends_at <= Utc::now() {
                return Err(HostError::Conflict);
            }
            let joined: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM live_module_participants WHERE session_id = ?1 AND student_id = ?2)",
                rusqlite::params![id.to_string(), student_id.to_string()],
                |row| row.get(0),
            )?;
            if !joined {
                return Err(HostError::Forbidden);
            }
            let latest: Option<i64> = conn.query_row(
                "SELECT max(revision) FROM live_session_tasks WHERE session_id = ?1",
                [id.to_string()],
                |row| row.get(0),
            )?;
            if latest != Some(i64::from(req.revision)) {
                return Err(HostError::Conflict);
            }
            if let Some((_, Some(current))) = load_current_task(conn, id, Some(student_id))? {
                if current.state == LiveSessionTaskState::Completed && req.state != LiveSessionTaskState::Completed {
                    return Ok(Json(current));
                }
            }
            let now = Utc::now();
            conn.execute(
                "INSERT INTO live_session_task_acknowledgements
                    (session_id, task_revision, student_id, state, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(session_id, task_revision, student_id) DO UPDATE SET
                    state = CASE
                        WHEN live_session_task_acknowledgements.state = 'completed' THEN 'completed'
                        ELSE excluded.state
                    END,
                    updated_at = excluded.updated_at",
                rusqlite::params![id.to_string(), req.revision, student_id.to_string(), req.state.as_str(), now.to_rfc3339()],
            )?;
            conn.execute(
                "INSERT INTO live_session_task_events
                    (session_id, task_revision, student_id, state, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![id.to_string(), req.revision, student_id.to_string(), req.state.as_str(), now.to_rfc3339()],
            )?;
            let acknowledgement = load_current_task(conn, id, Some(student_id))?
                .and_then(|(_, acknowledgement)| acknowledgement)
                .ok_or(HostError::NotFound("task acknowledgement"))?;
            Ok(Json(acknowledgement))
        })
        .await
}

async fn session_history(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(classroom_id): Path<Uuid>,
) -> HostResult<Json<Vec<LiveSessionHistoryItem>>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, classroom_id, teacher_id)?;
            let mut stmt = conn.prepare(
                "SELECT s.id, s.classroom_id, c.name, s.module_id, s.module_name,
                        s.duration_minutes, s.join_code, s.starts_at, s.ends_at, s.ended_at,
                        (SELECT count(*) FROM live_module_participants p WHERE p.session_id = s.id),
                        (SELECT count(*) FROM live_session_task_acknowledgements a
                          WHERE a.session_id = s.id AND a.state = 'completed'
                            AND a.task_revision = (SELECT max(revision) FROM live_session_tasks WHERE session_id = s.id))
                   FROM live_module_sessions s JOIN classrooms c ON c.id = s.classroom_id
                  WHERE s.classroom_id = ?1
                  ORDER BY s.starts_at DESC LIMIT 30",
            )?;
            let rows = stmt.query_map([classroom_id.to_string()], |row| {
                let session = session_row(row)?;
                let participants: i64 = row.get(10)?;
                let completed: i64 = row.get(11)?;
                Ok((session, participants, completed))
            })?;
            let mut history = Vec::new();
            for row in rows {
                let (session, participants, completed) = row?;
                history.push(LiveSessionHistoryItem {
                    session: with_task(conn, session?, None)?,
                    participant_count: participants.try_into().unwrap_or(u32::MAX),
                    completed_count: completed.try_into().unwrap_or(u32::MAX),
                });
            }
            Ok(Json(history))
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
                "INSERT INTO live_module_participants (session_id, student_id, joined_at, last_seen_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(session_id, student_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
                rusqlite::params![
                    session.id.to_string(),
                    student_id.to_string(),
                    now.to_rfc3339(),
                ],
            )?;
            Ok(Json(with_task(conn, session, Some(student_id))?))
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
            let session = with_task(conn, load_session(conn, id)?, None)?;
            require_teacher_access(conn, session.classroom_id, teacher_id)?;
            let mut stmt = conn.prepare(
                "SELECT p.student_id, u.display_name, p.joined_at, coalesce(p.last_seen_at, p.joined_at),
                        r.score, r.elapsed_seconds, r.submitted_at, r.task_revision,
                        a.state, a.updated_at, t.revision
                   FROM live_module_participants p
                   JOIN users u ON u.id = p.student_id
                   LEFT JOIN live_module_results r
                     ON r.session_id = p.session_id AND r.student_id = p.student_id
                   LEFT JOIN live_session_tasks t ON t.session_id = p.session_id
                    AND t.revision = (SELECT max(revision) FROM live_session_tasks WHERE session_id = p.session_id)
                   LEFT JOIN live_session_task_acknowledgements a
                     ON a.session_id = p.session_id AND a.student_id = p.student_id
                    AND a.task_revision = t.revision
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
                tasks: load_tasks(conn, id)?,
                task_progress: load_task_progress(conn, id)?,
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
            let task_revision: Option<i64> = conn.query_row(
                "SELECT max(revision) FROM live_session_tasks WHERE session_id = ?1",
                [id.to_string()],
                |row| row.get(0),
            )?;
            let inserted = conn.execute(
                "INSERT INTO live_module_results
                    (session_id, student_id, score, elapsed_seconds, submitted_at, task_revision)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(session_id, student_id) DO NOTHING",
                rusqlite::params![
                    id.to_string(),
                    student_id.to_string(),
                    req.score,
                    req.elapsed_seconds,
                    submitted_at,
                    task_revision,
                ],
            )?;
            if inserted == 0 {
                return Err(HostError::Conflict);
            }
            Ok(Json(LiveSessionResult {
                score: req.score,
                elapsed_seconds: req.elapsed_seconds,
                task_revision: task_revision
                    .map(|value| value.try_into())
                    .transpose()
                    .map_err(|error| {
                        HostError::Other(anyhow::anyhow!("bad task revision: {error}"))
                    })?,
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
            server_now: Utc::now(),
            current_task: None,
            student_task_state: None,
            student_joined: false,
        })
    })())
}

fn participant_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<HostResult<LiveSessionParticipant>> {
    let student_id: String = row.get(0)?;
    let joined_at: String = row.get(2)?;
    let last_seen_at: String = row.get(3)?;
    let score: Option<f64> = row.get(4)?;
    let elapsed_seconds: Option<i64> = row.get(5)?;
    let submitted_at: Option<String> = row.get(6)?;
    let result_task_revision: Option<i64> = row.get(7)?;
    let task_state: Option<String> = row.get(8)?;
    let task_updated_at: Option<String> = row.get(9)?;
    let task_revision: Option<i64> = row.get(10)?;
    Ok((|| {
        let result = match (score, elapsed_seconds, submitted_at) {
            (Some(score), Some(elapsed), Some(submitted)) => Some(LiveSessionResult {
                score,
                elapsed_seconds: elapsed.try_into().map_err(|error| {
                    HostError::Other(anyhow::anyhow!("bad elapsed time: {error}"))
                })?,
                task_revision: result_task_revision
                    .map(|value| value.try_into())
                    .transpose()
                    .map_err(|error| {
                        HostError::Other(anyhow::anyhow!("bad result task revision: {error}"))
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
            last_seen_at: parse_time(&last_seen_at)?,
            result,
            task_state: match (task_state, task_updated_at, task_revision) {
                (Some(state), Some(updated_at), Some(revision)) => {
                    Some(LiveSessionTaskAcknowledgement {
                        revision: revision.try_into().map_err(|error| {
                            HostError::Other(anyhow::anyhow!("bad task revision: {error}"))
                        })?,
                        state: state
                            .parse()
                            .map_err(|error: String| HostError::Other(anyhow::anyhow!(error)))?,
                        updated_at: parse_time(&updated_at)?,
                    })
                }
                (None, None, _) => None,
                _ => {
                    return Err(HostError::Other(anyhow::anyhow!(
                        "incomplete task acknowledgement"
                    )))
                }
            },
        })
    })())
}

fn with_task(
    conn: &rusqlite::Connection,
    mut session: LiveSession,
    student_id: Option<Uuid>,
) -> HostResult<LiveSession> {
    if let Some((task, state)) = load_current_task(conn, session.id, student_id)? {
        session.current_task = Some(task);
        session.student_task_state = state;
    }
    if let Some(student_id) = student_id {
        session.student_joined = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM live_module_participants WHERE session_id = ?1 AND student_id = ?2)",
            rusqlite::params![session.id.to_string(), student_id.to_string()],
            |row| row.get(0),
        )?;
    }
    Ok(session)
}

fn load_tasks(conn: &rusqlite::Connection, session_id: Uuid) -> HostResult<Vec<LiveSessionTask>> {
    let mut stmt = conn.prepare(
        "SELECT id, revision, kind, target_id, title, instructions, created_at
           FROM live_session_tasks WHERE session_id = ?1 ORDER BY revision",
    )?;
    let rows = stmt
        .query_map([session_id.to_string()], |row| {
            let id: String = row.get(0)?;
            let revision: i64 = row.get(1)?;
            let kind: String = row.get(2)?;
            let target_id: Option<String> = row.get(3)?;
            let created_at: String = row.get(6)?;
            Ok((|| {
                Ok(LiveSessionTask {
                    id: parse_uuid(&id, "live task")?,
                    revision: revision.try_into().map_err(|error| {
                        HostError::Other(anyhow::anyhow!("bad task revision: {error}"))
                    })?,
                    kind: kind
                        .parse()
                        .map_err(|error: String| HostError::Other(anyhow::anyhow!(error)))?,
                    target_id: target_id
                        .map(|value| parse_uuid(&value, "task target"))
                        .transpose()?,
                    title: row.get(4)?,
                    instructions: row.get(5)?,
                    created_at: parse_time(&created_at)?,
                })
            })())
        })?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .collect();
    rows
}

fn load_task_progress(
    conn: &rusqlite::Connection,
    session_id: Uuid,
) -> HostResult<Vec<LiveSessionTaskProgress>> {
    let tasks = load_tasks(conn, session_id)?;
    let mut progress = Vec::with_capacity(tasks.len());
    for task in tasks {
        let mut stmt = conn.prepare(
            "SELECT p.student_id, u.display_name, a.state, a.updated_at,
                    r.score, r.elapsed_seconds, r.submitted_at, r.task_revision
               FROM live_module_participants p
               JOIN users u ON u.id = p.student_id
               LEFT JOIN live_session_task_acknowledgements a
                 ON a.session_id = p.session_id AND a.student_id = p.student_id AND a.task_revision = ?2
               LEFT JOIN live_module_results r
                 ON r.session_id = p.session_id AND r.student_id = p.student_id AND r.task_revision = ?2
              WHERE p.session_id = ?1 ORDER BY lower(u.display_name)",
        )?;
        let participants = stmt
            .query_map(
                rusqlite::params![session_id.to_string(), task.revision],
                |row| {
                    let student_id: String = row.get(0)?;
                    let state: Option<String> = row.get(2)?;
                    let state_updated: Option<String> = row.get(3)?;
                    let score: Option<f64> = row.get(4)?;
                    let elapsed: Option<i64> = row.get(5)?;
                    let submitted: Option<String> = row.get(6)?;
                    let result_revision: Option<i64> = row.get(7)?;
                    Ok((|| {
                        let acknowledgement = match (state, state_updated) {
                            (Some(state), Some(updated_at)) => {
                                Some(LiveSessionTaskAcknowledgement {
                                    revision: task.revision,
                                    state: state.parse().map_err(|error: String| {
                                        HostError::Other(anyhow::anyhow!(error))
                                    })?,
                                    updated_at: parse_time(&updated_at)?,
                                })
                            }
                            (None, None) => None,
                            _ => {
                                return Err(HostError::Other(anyhow::anyhow!(
                                    "incomplete task acknowledgement"
                                )))
                            }
                        };
                        let result = match (score, elapsed, submitted, result_revision) {
                            (Some(score), Some(elapsed), Some(submitted), Some(revision)) => {
                                Some(LiveSessionResult {
                                    score,
                                    elapsed_seconds: elapsed.try_into().map_err(|error| {
                                        HostError::Other(anyhow::anyhow!(
                                            "bad elapsed time: {error}"
                                        ))
                                    })?,
                                    task_revision: Some(revision.try_into().map_err(|error| {
                                        HostError::Other(anyhow::anyhow!(
                                            "bad result task revision: {error}"
                                        ))
                                    })?),
                                    submitted_at: parse_time(&submitted)?,
                                })
                            }
                            (None, None, None, None) => None,
                            _ => {
                                return Err(HostError::Other(anyhow::anyhow!(
                                    "incomplete live session result"
                                )))
                            }
                        };
                        Ok(LiveSessionTaskParticipantProgress {
                            student_id: parse_uuid(&student_id, "student")?,
                            student_name: row.get(1)?,
                            state: acknowledgement,
                            result,
                        })
                    })())
                },
            )?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .collect::<HostResult<Vec<_>>>()?;
        progress.push(LiveSessionTaskProgress { task, participants });
    }
    Ok(progress)
}

fn load_current_task(
    conn: &rusqlite::Connection,
    session_id: Uuid,
    student_id: Option<Uuid>,
) -> HostResult<Option<(LiveSessionTask, Option<LiveSessionTaskAcknowledgement>)>> {
    conn.query_row(
        "SELECT t.id, t.revision, t.kind, t.target_id, t.title, t.instructions, t.created_at,
                a.state, a.updated_at
           FROM live_session_tasks t
           LEFT JOIN live_session_task_acknowledgements a
             ON a.session_id = t.session_id AND a.task_revision = t.revision AND a.student_id = ?2
          WHERE t.session_id = ?1 ORDER BY t.revision DESC LIMIT 1",
        rusqlite::params![
            session_id.to_string(),
            student_id.map(|value| value.to_string())
        ],
        |row| {
            let id: String = row.get(0)?;
            let revision: i64 = row.get(1)?;
            let kind: String = row.get(2)?;
            let target_id: Option<String> = row.get(3)?;
            let created_at: String = row.get(6)?;
            let state: Option<String> = row.get(7)?;
            let state_updated_at: Option<String> = row.get(8)?;
            Ok((|| {
                let revision: u32 = revision.try_into().map_err(|error| {
                    HostError::Other(anyhow::anyhow!("bad task revision: {error}"))
                })?;
                let task = LiveSessionTask {
                    id: parse_uuid(&id, "live task")?,
                    revision,
                    kind: kind
                        .parse()
                        .map_err(|error: String| HostError::Other(anyhow::anyhow!(error)))?,
                    target_id: target_id
                        .map(|value| parse_uuid(&value, "task target"))
                        .transpose()?,
                    title: row.get(4)?,
                    instructions: row.get(5)?,
                    created_at: parse_time(&created_at)?,
                };
                let acknowledgement = match (state, state_updated_at) {
                    (Some(state), Some(updated_at)) => Some(LiveSessionTaskAcknowledgement {
                        revision,
                        state: state
                            .parse()
                            .map_err(|error: String| HostError::Other(anyhow::anyhow!(error)))?,
                        updated_at: parse_time(&updated_at)?,
                    }),
                    (None, None) => None,
                    _ => {
                        return Err(HostError::Other(anyhow::anyhow!(
                            "incomplete task acknowledgement"
                        )))
                    }
                };
                Ok((task, acknowledgement))
            })())
        },
    )
    .optional()?
    .transpose()
}

fn validate_task(
    conn: &rusqlite::Connection,
    session_id: Uuid,
    classroom_id: Uuid,
    req: &AssignLiveSessionTaskRequest,
) -> HostResult<()> {
    if req.title.trim().is_empty() || req.title.chars().count() > 200 {
        return Err(HostError::BadRequest(
            "Task title must contain between 1 and 200 characters.".into(),
        ));
    }
    if req.instructions.chars().count() > 2_000 {
        return Err(HostError::BadRequest(
            "Task instructions cannot exceed 2,000 characters.".into(),
        ));
    }
    match req.kind {
        LiveSessionTaskKind::Instruction if req.target_id.is_some() => Err(HostError::BadRequest(
            "Written instructions cannot have a target.".into(),
        )),
        LiveSessionTaskKind::Instruction => Ok(()),
        LiveSessionTaskKind::Assignment => {
            let target = req
                .target_id
                .ok_or_else(|| HostError::BadRequest("Choose an assignment.".into()))?;
            let valid: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM assignments WHERE id = ?1 AND classroom_id = ?2 AND status = 'published')",
                rusqlite::params![target.to_string(), classroom_id.to_string()], |row| row.get(0))?;
            if valid {
                Ok(())
            } else {
                Err(HostError::BadRequest(
                    "The assignment is not published in this classroom.".into(),
                ))
            }
        }
        LiveSessionTaskKind::Material => {
            let target = req
                .target_id
                .ok_or_else(|| HostError::BadRequest("Choose a material.".into()))?;
            let valid: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM nodes n WHERE n.id = ?1 AND n.classroom_id = ?2 AND n.kind = 'pdf' AND n.owner_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM trashed_files t WHERE t.node_id = n.id))",
                rusqlite::params![target.to_string(), classroom_id.to_string()], |row| row.get(0))?;
            if valid {
                Ok(())
            } else {
                Err(HostError::BadRequest(
                    "The material is not shared with this classroom.".into(),
                ))
            }
        }
        LiveSessionTaskKind::Quiz => {
            let target = req
                .target_id
                .ok_or_else(|| HostError::BadRequest("Choose a published quiz.".into()))?;
            let valid: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM quiz_deliveries
                  WHERE id=?1 AND classroom_id=?2 AND kind='live' AND live_session_id=?3)",
                rusqlite::params![
                    target.to_string(),
                    classroom_id.to_string(),
                    session_id.to_string()
                ],
                |row| row.get(0),
            )?;
            if valid {
                Ok(())
            } else {
                Err(HostError::BadRequest(
                    "The quiz is not assigned to this live session.".into(),
                ))
            }
        }
    }
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
    use super::{
        acknowledge_task, active_for_classroom, active_for_student, assign_task, details, end,
        join, join_by_id, start, submit_result,
    };
    use crate::auth::CurrentUser;
    use crate::{db, AppState};
    use axum::extract::{Path, State};
    use axum::Json;
    use chrono::Utc;
    use cinder_ai::Ai;
    use cinder_core::{
        AcknowledgeLiveSessionTaskRequest, AssignLiveSessionTaskRequest, JoinLiveSessionRequest,
        LiveSessionTaskKind, LiveSessionTaskState, Role, StartLiveSessionRequest,
        SubmitLiveSessionResultRequest, User,
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
        assert_eq!(not_joined.as_ref().map(|value| value.id), Some(session.id));
        assert!(not_joined.unwrap().student_task_state.is_none());

        let Json(discovered) = active_for_student(
            State(state.clone()),
            current(student, "student", Role::Student),
        )
        .await
        .unwrap();
        assert_eq!(
            discovered.len(),
            1,
            "enrolled students discover live classes before joining"
        );

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

        let _ = join_by_id(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(session.id),
        )
        .await
        .unwrap();
        let participant_count: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM live_module_participants WHERE session_id = ?1",
                [session.id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(participant_count, 1, "one-click joining must be idempotent");

        pool.get().unwrap().execute(
            "UPDATE live_module_participants SET last_seen_at = '2000-01-01T00:00:00Z' WHERE session_id = ?1",
            [session.id.to_string()],
        ).unwrap();
        let _ = active_for_student(
            State(state.clone()),
            current(student, "student", Role::Student),
        )
        .await
        .unwrap();
        let last_seen: String = pool.get().unwrap().query_row(
            "SELECT last_seen_at FROM live_module_participants WHERE session_id = ?1 AND student_id = ?2",
            rusqlite::params![session.id.to_string(), student.to_string()], |row| row.get(0)).unwrap();
        assert_ne!(
            last_seen, "2000-01-01T00:00:00Z",
            "discovery polling is the participant heartbeat"
        );

        let trashed_material = Uuid::new_v4();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO nodes (id, owner_id, parent_id, name, kind, position, created_at, updated_at, classroom_id)
                 VALUES (?1, NULL, NULL, 'Old handout', 'pdf', 0, ?2, ?2, ?3)",
                rusqlite::params![trashed_material.to_string(), now.to_rfc3339(), classroom.to_string()],
            ).unwrap();
            conn.execute(
                "INSERT INTO trashed_files (node_id, trashed_at, trashed_by) VALUES (?1, ?2, 'host-admin')",
                rusqlite::params![trashed_material.to_string(), now.to_rfc3339()],
            ).unwrap();
        }
        let trashed_task = assign_task(
            State(state.clone()),
            current(owner, "owner", Role::Teacher),
            Path(session.id),
            Json(AssignLiveSessionTaskRequest {
                kind: LiveSessionTaskKind::Material,
                target_id: Some(trashed_material),
                title: "Old handout".into(),
                instructions: "".into(),
            }),
        )
        .await;
        assert!(matches!(
            trashed_task,
            Err(crate::error::HostError::BadRequest(_))
        ));

        let Json(task) = assign_task(
            State(state.clone()),
            current(owner, "owner", Role::Teacher),
            Path(session.id),
            Json(AssignLiveSessionTaskRequest {
                kind: LiveSessionTaskKind::Instruction,
                target_id: None,
                title: "Read the worked example".into(),
                instructions: "Mark complete when ready.".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(task.revision, 1);
        let Json(ack) = acknowledge_task(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(session.id),
            Json(AcknowledgeLiveSessionTaskRequest {
                revision: task.revision,
                state: LiveSessionTaskState::Completed,
            }),
        )
        .await
        .unwrap();
        assert_eq!(ack.state, LiveSessionTaskState::Completed);

        pool.get()
            .unwrap()
            .execute(
                "UPDATE live_module_sessions SET ends_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
                [session.id.to_string()],
            )
            .unwrap();
        let expired_ack = acknowledge_task(
            State(state.clone()),
            current(student, "student", Role::Student),
            Path(session.id),
            Json(AcknowledgeLiveSessionTaskRequest {
                revision: task.revision,
                state: LiveSessionTaskState::Opened,
            }),
        )
        .await;
        assert!(matches!(
            expired_ack,
            Err(crate::error::HostError::Conflict)
        ));
        pool.get()
            .unwrap()
            .execute(
                "UPDATE live_module_sessions SET ends_at = ?2 WHERE id = ?1",
                rusqlite::params![session.id.to_string(), session.ends_at.to_rfc3339()],
            )
            .unwrap();
        let event_count: i64 = pool.get().unwrap().query_row(
            "SELECT count(*) FROM live_session_task_events WHERE session_id = ?1 AND student_id = ?2",
            rusqlite::params![session.id.to_string(), student.to_string()], |row| row.get(0)).unwrap();
        assert_eq!(event_count, 1, "rejected transitions are not appended");

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
        assert_eq!(
            detail.participants[0]
                .result
                .as_ref()
                .unwrap()
                .task_revision,
            Some(1)
        );
        assert_eq!(detail.session.current_task.as_ref().unwrap().revision, 1);
        assert_eq!(
            detail.participants[0].task_state.as_ref().unwrap().state,
            LiveSessionTaskState::Completed
        );
        assert_eq!(detail.task_progress.len(), 1);
        assert_eq!(detail.task_progress[0].task.revision, 1);
        assert_eq!(detail.task_progress[0].participants.len(), 1);
        assert_eq!(
            detail.task_progress[0].participants[0]
                .state
                .as_ref()
                .unwrap()
                .state,
            LiveSessionTaskState::Completed
        );
        assert_eq!(
            detail.task_progress[0].participants[0]
                .result
                .as_ref()
                .unwrap()
                .task_revision,
            Some(1)
        );

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
