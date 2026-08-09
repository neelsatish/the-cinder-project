//! One authoritative attendance register per school day.

use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{NaiveDate, Utc};
use cinder_core::{AttendanceDay, AttendanceRecord, AttendanceStatus, SaveAttendanceRequest};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/attendance/{day}", get(read_day).put(save_record))
}

async fn read_day(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(day): Path<String>,
) -> HostResult<Json<AttendanceDay>> {
    teacher.require_teacher()?;
    let date = parse_day(&day)?;
    state
        .db(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT u.id, u.display_name, r.status, coalesce(r.note, ''),
                        EXISTS(
                            SELECT 1 FROM sessions s
                             WHERE s.user_id = u.id AND date(s.created_at, 'localtime') = ?1
                        )
                   FROM users u
                   LEFT JOIN attendance_days d ON d.day = ?1
                   LEFT JOIN attendance_records r ON r.day_id = d.id AND r.student_id = u.id
                  WHERE u.role = 'student' AND u.disabled_at IS NULL
                  ORDER BY lower(u.display_name)",
            )?;
            let rows = stmt
                .query_map([date.to_string()], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, bool>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let records = rows
                .into_iter()
                .map(|row| {
                    Ok(AttendanceRecord {
                        student_id: row.0.parse().map_err(|error| {
                            HostError::Other(anyhow::anyhow!("bad student id: {error}"))
                        })?,
                        student_name: row.1,
                        status: row
                            .2
                            .map(|value| value.parse::<AttendanceStatus>())
                            .transpose()
                            .map_err(|error| HostError::Other(anyhow::anyhow!("{error}")))?,
                        note: row.3,
                        checked_in: row.4,
                    })
                })
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(AttendanceDay { day: date, records }))
        })
        .await
}

async fn save_record(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(day): Path<String>,
    Json(req): Json<SaveAttendanceRequest>,
) -> HostResult<Json<AttendanceRecord>> {
    teacher.require_teacher()?;
    let date = parse_day(&day)?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let student_name: String = conn
                .query_row(
                    "SELECT display_name FROM users
                      WHERE id = ?1 AND role = 'student' AND disabled_at IS NULL",
                    [req.student_id.to_string()],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or(HostError::NotFound("student"))?;
            let day_id = conn
                .query_row(
                    "SELECT id FROM attendance_days WHERE day = ?1",
                    [date.to_string()],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .map(|value| {
                    value.parse::<Uuid>().map_err(|error| {
                        HostError::Other(anyhow::anyhow!("bad attendance day id: {error}"))
                    })
                })
                .transpose()?
                .unwrap_or_else(Uuid::new_v4);
            let now = Utc::now();
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO attendance_days (id, day, created_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(day) DO NOTHING",
                rusqlite::params![day_id.to_string(), date.to_string(), now.to_rfc3339()],
            )?;
            let real_day_id: String = tx.query_row(
                "SELECT id FROM attendance_days WHERE day = ?1",
                [date.to_string()],
                |row| row.get(0),
            )?;
            tx.execute(
                "INSERT INTO attendance_records
                    (day_id, student_id, status, note, marked_by, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(day_id, student_id) DO UPDATE SET
                    status = excluded.status,
                    note = excluded.note,
                    marked_by = excluded.marked_by,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    real_day_id,
                    req.student_id.to_string(),
                    req.status.as_str(),
                    req.note.trim(),
                    teacher_id.to_string(),
                    now.to_rfc3339(),
                ],
            )?;
            tx.commit()?;
            Ok(Json(AttendanceRecord {
                student_id: req.student_id,
                student_name,
                status: Some(req.status),
                note: req.note.trim().to_owned(),
                checked_in: false,
            }))
        })
        .await
}

fn parse_day(raw: &str) -> HostResult<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| HostError::BadRequest("Date must be written as YYYY-MM-DD.".into()))
}
