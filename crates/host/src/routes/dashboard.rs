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
    let today = Local::now().date_naive().to_string();
    state
        .db(move |conn| {
            let students = count(
                conn,
                "SELECT count(*) FROM users WHERE role = 'student' AND disabled_at IS NULL",
            )?;
            let classrooms = count(
                conn,
                "SELECT count(*) FROM classrooms WHERE archived_at IS NULL",
            )?;
            let pending_submissions = count(
                conn,
                "SELECT count(*) FROM submissions WHERE status IN ('submitted','resubmitted')",
            )?;
            let ungraded_submissions = count(
                conn,
                "SELECT count(*) FROM submissions s LEFT JOIN grades g ON g.submission_id = s.id
                  WHERE s.status <> 'withdrawn' AND (g.id IS NULL OR g.published = 0)",
            )?;
            let present_today = conn.query_row(
                "SELECT count(*)
                   FROM attendance_records r JOIN attendance_days d ON d.id = r.day_id
                  WHERE d.day = ?1 AND r.status IN ('present','late')",
                [today],
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

fn count(conn: &rusqlite::Connection, sql: &str) -> rusqlite::Result<i64> {
    conn.query_row(sql, [], |row| row.get(0))
}
