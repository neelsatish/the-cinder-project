//! One authoritative attendance register per classroom and school day.

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{NaiveDate, Utc};
use cinder_core::{AttendanceDay, AttendanceRecord, AttendanceStatus, SaveAttendanceRequest};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::routes::classrooms::require_teacher_access;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/classrooms/{classroom_id}/attendance/{day}",
        get(read_day).put(save_record),
    )
}

async fn read_day(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path((classroom_id, day)): Path<(Uuid, String)>,
) -> HostResult<Json<AttendanceDay>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    let date = parse_day(&day)?;
    state
        .db(move |conn| {
            require_teacher_access(conn, classroom_id, teacher_id)?;
            let mut stmt = conn.prepare(
                "SELECT u.id, u.display_name, r.status, coalesce(r.note, ''),
                        EXISTS(
                            SELECT 1 FROM sessions s
                             WHERE s.user_id = u.id AND date(s.created_at, 'localtime') = ?1
                        ),
                        (SELECT count(*) FROM attendance_records history
                          WHERE history.classroom_id = ?2 AND history.student_id = u.id
                            AND history.status = 'present'),
                        (SELECT count(*) FROM attendance_records history
                          WHERE history.classroom_id = ?2 AND history.student_id = u.id)
                   FROM users u
                   LEFT JOIN attendance_days d ON d.day = ?1
                   LEFT JOIN attendance_records r
                     ON r.day_id = d.id
                    AND r.classroom_id = ?2
                    AND r.student_id = u.id
                  WHERE u.role = 'student' AND u.disabled_at IS NULL
                    AND EXISTS(SELECT 1 FROM classroom_enrolments e
                                WHERE e.classroom_id = ?2 AND e.student_id = u.id)
                  ORDER BY lower(u.display_name)",
            )?;
            let rows = stmt
                .query_map(
                    rusqlite::params![date.to_string(), classroom_id.to_string()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, bool>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                )?
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
                        present_percentage: attendance_percentage(row.5, row.6),
                    })
                })
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(AttendanceDay {
                classroom_id,
                day: date,
                records,
            }))
        })
        .await
}

async fn save_record(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path((classroom_id, day)): Path<(Uuid, String)>,
    Json(req): Json<SaveAttendanceRequest>,
) -> HostResult<Json<AttendanceRecord>> {
    teacher.require_teacher()?;
    let date = parse_day(&day)?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, classroom_id, teacher_id)?;
            let student_name: String = conn
                .query_row(
                    "SELECT display_name FROM users
                      WHERE id = ?1 AND role = 'student' AND disabled_at IS NULL
                        AND EXISTS(SELECT 1 FROM classroom_enrolments e
                                    WHERE e.classroom_id = ?2 AND e.student_id = users.id)",
                    rusqlite::params![req.student_id.to_string(), classroom_id.to_string()],
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
                    (day_id, classroom_id, student_id, status, note, marked_by, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(day_id, classroom_id, student_id) DO UPDATE SET
                    status = excluded.status,
                    note = excluded.note,
                    marked_by = excluded.marked_by,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    real_day_id,
                    classroom_id.to_string(),
                    req.student_id.to_string(),
                    req.status.as_str(),
                    req.note.trim(),
                    teacher_id.to_string(),
                    now.to_rfc3339(),
                ],
            )?;
            tx.commit()?;
            let (present_days, recorded_days): (i64, i64) = conn.query_row(
                "SELECT count(*) FILTER (WHERE status = 'present'), count(*)
                   FROM attendance_records
                  WHERE classroom_id = ?1 AND student_id = ?2",
                rusqlite::params![classroom_id.to_string(), req.student_id.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok(Json(AttendanceRecord {
                student_id: req.student_id,
                student_name,
                status: Some(req.status),
                note: req.note.trim().to_owned(),
                checked_in: false,
                present_percentage: attendance_percentage(present_days, recorded_days),
            }))
        })
        .await
}

fn parse_day(raw: &str) -> HostResult<NaiveDate> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| HostError::BadRequest("Date must be written as YYYY-MM-DD.".into()))
}

fn attendance_percentage(present_days: i64, recorded_days: i64) -> Option<u8> {
    (recorded_days > 0).then(|| ((present_days * 100 + recorded_days / 2) / recorded_days) as u8)
}

#[cfg(test)]
mod tests {
    use super::{attendance_percentage, read_day, save_record};
    use crate::auth::CurrentUser;
    use crate::{db, AppState};
    use axum::extract::{Path, State};
    use axum::Json;
    use chrono::Utc;
    use cinder_ai::Ai;
    use cinder_core::{AttendanceStatus, Role, SaveAttendanceRequest, User};
    use std::sync::Arc;
    use uuid::Uuid;

    #[test]
    fn attendance_percentage_is_rounded_and_empty_history_is_unset() {
        assert_eq!(attendance_percentage(0, 0), None);
        assert_eq!(attendance_percentage(2, 3), Some(67));
        assert_eq!(attendance_percentage(3, 4), Some(75));
    }

    #[tokio::test]
    async fn attendance_is_limited_to_the_teachers_classrooms() {
        let pool = db::open_in_memory().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let teacher = Uuid::new_v4();
        let other_teacher = Uuid::new_v4();
        let student = Uuid::new_v4();
        let other_student = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let other_classroom = Uuid::new_v4();
        let now = Utc::now();
        {
            let conn = pool.get().unwrap();
            for (id, username, role) in [
                (teacher, "teacher", "teacher"),
                (other_teacher, "other-teacher", "teacher"),
                (student, "student", "student"),
                (other_student, "other-student", "student"),
            ] {
                conn.execute(
                    "INSERT INTO users (id, username, display_name, pw_hash, role, created_at)
                     VALUES (?1, ?2, ?2, 'hash', ?3, ?4)",
                    rusqlite::params![id.to_string(), username, role, now.to_rfc3339()],
                )
                .unwrap();
            }
            for (id, owner, code) in [
                (classroom, teacher, "ABCD2345"),
                (other_classroom, other_teacher, "EFGH6789"),
            ] {
                conn.execute(
                    "INSERT INTO classrooms
                        (id, name, description, color, created_at, owner_teacher_id, enrolment_code)
                     VALUES (?1, 'Class', '', '#BEC2FF', ?2, ?3, ?4)",
                    rusqlite::params![id.to_string(), now.to_rfc3339(), owner.to_string(), code],
                )
                .unwrap();
            }
            for (classroom_id, student_id) in
                [(classroom, student), (other_classroom, other_student)]
            {
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
            }
        }
        let state = AppState {
            pool,
            files_dir: directory.path().to_owned(),
            ai: Arc::new(Ai::disabled()),
            ai_key_secret: [0; 32],
        };
        let current = CurrentUser(
            User {
                id: teacher,
                username: "teacher".into(),
                display_name: "Teacher".into(),
                role: Role::Teacher,
                grade_level: None,
                section: None,
                roll_number: None,
                must_change_password: false,
                created_at: now,
            },
            "token".into(),
        );

        let Json(day) = read_day(
            State(state.clone()),
            current.clone(),
            Path((classroom, "2026-09-06".into())),
        )
        .await
        .unwrap();
        assert_eq!(day.classroom_id, classroom);
        assert_eq!(day.records.len(), 1);
        assert_eq!(day.records[0].student_id, student);

        let rejected = save_record(
            State(state.clone()),
            current.clone(),
            Path((classroom, "2026-09-06".into())),
            Json(SaveAttendanceRequest {
                student_id: other_student,
                status: AttendanceStatus::Present,
                note: String::new(),
            }),
        )
        .await;
        assert!(matches!(
            rejected,
            Err(crate::error::HostError::NotFound("student"))
        ));

        let unrelated_class = read_day(
            State(state),
            current,
            Path((other_classroom, "2026-09-06".into())),
        )
        .await;
        assert!(matches!(
            unrelated_class,
            Err(crate::error::HostError::Forbidden)
        ));
    }
}
