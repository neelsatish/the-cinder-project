//! Small aggregate queries for the teacher command center.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Local;
use cinder_core::DashboardStats;

use crate::auth::CurrentUser;
use crate::error::HostResult;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/teacher/dashboard", get(stats))
}

async fn stats(
    State(state): State<AppState>,
    teacher: CurrentUser,
) -> HostResult<Json<DashboardStats>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id().to_string();
    let today = Local::now().date_naive().to_string();
    state
        .db(move |conn| {
            let access = "(c.owner_teacher_id = ?1 OR EXISTS(
                SELECT 1 FROM classroom_teachers ct
                 WHERE ct.classroom_id = c.id AND ct.teacher_id = ?1
            ))";
            let students = conn.query_row(
                &format!(
                    "SELECT count(DISTINCT e.student_id)
                    FROM classroom_enrolments e JOIN classrooms c ON c.id = e.classroom_id
                   WHERE c.archived_at IS NULL AND {access}"
                ),
                [&teacher_id],
                |row| row.get(0),
            )?;
            let classrooms = conn.query_row(
                &format!(
                    "SELECT count(*) FROM classrooms c
                    WHERE c.archived_at IS NULL AND {access}"
                ),
                [&teacher_id],
                |row| row.get(0),
            )?;
            let pending_submissions = conn.query_row(
                &format!(
                    "SELECT count(*) FROM submissions s
                    JOIN assignments a ON a.id = s.assignment_id
                    JOIN classrooms c ON c.id = a.classroom_id
                   WHERE s.status IN ('submitted','resubmitted') AND {access}"
                ),
                [&teacher_id],
                |row| row.get(0),
            )?;
            let ungraded_submissions = conn.query_row(
                &format!(
                    "SELECT count(*) FROM submissions s
                    JOIN assignments a ON a.id = s.assignment_id
                    JOIN classrooms c ON c.id = a.classroom_id
                    LEFT JOIN grades g ON g.submission_id = s.id
                   WHERE s.status <> 'withdrawn' AND (g.id IS NULL OR g.published = 0)
                     AND {access}"
                ),
                [&teacher_id],
                |row| row.get(0),
            )?;
            let present_today = conn.query_row(
                &format!(
                    "SELECT count(DISTINCT r.student_id)
                       FROM attendance_records r
                       JOIN attendance_days d ON d.id = r.day_id
                       JOIN classrooms c ON c.id = r.classroom_id
                      WHERE d.day = ?2 AND r.status IN ('present','late')
                        AND c.archived_at IS NULL AND {access}"
                ),
                rusqlite::params![teacher_id, today],
                |row| row.get(0),
            )?;
            Ok(Json(DashboardStats {
                students,
                classrooms,
                pending_submissions,
                ungraded_submissions,
                present_today,
            }))
        })
        .await
}
