//! Assignments, versioned submissions, comments, and auditable grades.

use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use cinder_core::{
    AddCommentRequest, Assignment, AssignmentStatus, CreateAssignmentRequest, Grade, GradeChange,
    SaveGradeRequest, Submission, SubmissionComment, SubmissionStatus, SubmissionVersion,
    SubmitWorkRequest, UpdateAssignmentRequest,
};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/assignments",
            get(list_assignments).post(create_assignment),
        )
        .route(
            "/api/assignments/{id}",
            get(get_assignment)
                .patch(update_assignment)
                .delete(delete_assignment),
        )
        .route(
            "/api/assignments/{id}/submission",
            get(get_my_submission)
                .put(submit_work)
                .delete(withdraw_work),
        )
        .route("/api/assignments/{id}/submissions", get(list_submissions))
        .route("/api/submissions/{id}", get(get_submission))
        .route("/api/submissions/{id}/grade", put(save_grade))
        .route(
            "/api/submissions/{id}/comments",
            get(list_comments).post(add_comment),
        )
        .route("/api/submissions/{id}/grade-history", get(grade_history))
}

#[derive(Debug, Deserialize)]
struct AssignmentQuery {
    classroom_id: Option<Uuid>,
}

async fn list_assignments(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(query): Query<AssignmentQuery>,
) -> HostResult<Json<Vec<Assignment>>> {
    let user_id = user.id().to_string();
    let teacher = user.0.role.is_teacher();
    state
        .db(move |conn| {
            let mut sql = String::from(
                "SELECT a.id, a.classroom_id, c.name, a.title, a.instructions, a.due_at,
                        a.max_points, a.grading_scheme_json, a.status, a.created_at, a.updated_at
                   FROM assignments a JOIN classrooms c ON c.id = a.classroom_id",
            );
            if teacher {
                sql.push_str(" WHERE a.archived_at IS NULL AND c.archived_at IS NULL");
                if query.classroom_id.is_some() {
                    sql.push_str(" AND a.classroom_id = ?1");
                }
            } else {
                sql.push_str(
                    " JOIN classroom_enrolments e ON e.classroom_id = a.classroom_id
                      WHERE e.student_id = ?1 AND a.status IN ('published','closed')
                        AND a.archived_at IS NULL AND c.archived_at IS NULL",
                );
                if query.classroom_id.is_some() {
                    sql.push_str(" AND a.classroom_id = ?2");
                }
            }
            sql.push_str(" ORDER BY a.due_at IS NULL, a.due_at, lower(a.title)");

            let mut stmt = conn.prepare(&sql)?;
            let rows = match (teacher, query.classroom_id) {
                (true, Some(id)) => stmt
                    .query_map([id.to_string()], assignment_row)?
                    .collect::<Result<Vec<_>, _>>()?,
                (true, None) => stmt
                    .query_map([], assignment_row)?
                    .collect::<Result<Vec<_>, _>>()?,
                (false, Some(id)) => stmt
                    .query_map(rusqlite::params![user_id, id.to_string()], assignment_row)?
                    .collect::<Result<Vec<_>, _>>()?,
                (false, None) => stmt
                    .query_map([user_id], assignment_row)?
                    .collect::<Result<Vec<_>, _>>()?,
            };
            let assignments = rows.into_iter().collect::<HostResult<Vec<_>>>()?;
            Ok(Json(assignments))
        })
        .await
}

async fn create_assignment(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Json(req): Json<CreateAssignmentRequest>,
) -> HostResult<Json<Assignment>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            if req.title.trim().is_empty() {
                return Err(HostError::BadRequest(
                    "Assignment title is required.".into(),
                ));
            }
            if !req.max_points.is_finite() || req.max_points < 0.0 {
                return Err(HostError::BadRequest(
                    "Maximum points must be zero or greater.".into(),
                ));
            }
            let classroom_name: String = conn
                .query_row(
                    "SELECT name FROM classrooms WHERE id = ?1 AND archived_at IS NULL",
                    [req.classroom_id.to_string()],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or(HostError::NotFound("classroom"))?;
            let id = Uuid::new_v4();
            let now = Utc::now();
            let status = if req.publish {
                AssignmentStatus::Published
            } else {
                AssignmentStatus::Draft
            };
            let grading_json = serde_json::to_string(&req.grading_scheme).map_err(|error| {
                HostError::BadRequest(format!("Invalid grading scheme: {error}"))
            })?;
            conn.execute(
                "INSERT INTO assignments
                    (id, classroom_id, title, instructions, due_at, max_points,
                     grading_scheme_json, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                rusqlite::params![
                    id.to_string(),
                    req.classroom_id.to_string(),
                    req.title.trim(),
                    req.instructions.trim(),
                    req.due_at.map(|value| value.to_rfc3339()),
                    req.max_points,
                    grading_json,
                    status.as_str(),
                    now.to_rfc3339(),
                ],
            )?;
            Ok(Json(Assignment {
                id,
                classroom_id: req.classroom_id,
                classroom_name,
                title: req.title.trim().to_owned(),
                instructions: req.instructions.trim().to_owned(),
                due_at: req.due_at,
                max_points: req.max_points,
                grading_scheme: req.grading_scheme,
                status,
                created_at: now,
                updated_at: now,
            }))
        })
        .await
}

async fn get_assignment(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<Assignment>> {
    state
        .db(move |conn| {
            let assignment = load_assignment(conn, id)?;
            assert_assignment_visible(conn, &user, &assignment)?;
            Ok(Json(assignment))
        })
        .await
}

async fn update_assignment(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateAssignmentRequest>,
) -> HostResult<Json<Assignment>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            load_assignment(conn, id)?;
            if req.title.trim().is_empty() {
                return Err(HostError::BadRequest(
                    "Assignment title is required.".into(),
                ));
            }
            if !req.max_points.is_finite() || req.max_points < 0.0 {
                return Err(HostError::BadRequest(
                    "Maximum points must be zero or greater.".into(),
                ));
            }
            let highest_grade: Option<f64> = conn.query_row(
                "SELECT max(g.points)
                   FROM submissions s JOIN grades g ON g.submission_id = s.id
                  WHERE s.assignment_id = ?1",
                [id.to_string()],
                |row| row.get(0),
            )?;
            if highest_grade.is_some_and(|points| points > req.max_points) {
                return Err(HostError::BadRequest(
                    "Maximum points cannot be lower than an existing grade.".into(),
                ));
            }
            let classroom_exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM classrooms WHERE id = ?1 AND archived_at IS NULL)",
                [req.classroom_id.to_string()],
                |row| row.get(0),
            )?;
            if !classroom_exists {
                return Err(HostError::NotFound("classroom"));
            }
            let grading_json = serde_json::to_string(&req.grading_scheme).map_err(|error| {
                HostError::BadRequest(format!("Invalid grading scheme: {error}"))
            })?;
            conn.execute(
                "UPDATE assignments
                    SET classroom_id = ?2, title = ?3, instructions = ?4, due_at = ?5,
                        max_points = ?6, grading_scheme_json = ?7, status = ?8, updated_at = ?9
                  WHERE id = ?1 AND archived_at IS NULL",
                rusqlite::params![
                    id.to_string(),
                    req.classroom_id.to_string(),
                    req.title.trim(),
                    req.instructions.trim(),
                    req.due_at.map(|value| value.to_rfc3339()),
                    req.max_points,
                    grading_json,
                    req.status.as_str(),
                    Utc::now().to_rfc3339(),
                ],
            )?;
            load_assignment(conn, id).map(Json)
        })
        .await
}

async fn delete_assignment(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            load_assignment(conn, id)?;
            let changed = conn.execute(
                "UPDATE assignments
                    SET archived_at = ?2, status = 'closed', updated_at = ?2
                  WHERE id = ?1 AND archived_at IS NULL",
                rusqlite::params![id.to_string(), Utc::now().to_rfc3339()],
            )?;
            if changed == 0 {
                return Err(HostError::NotFound("assignment"));
            }
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

async fn submit_work(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(assignment_id): Path<Uuid>,
    Json(req): Json<SubmitWorkRequest>,
) -> HostResult<Json<Submission>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    state
        .db(move |conn| {
            let assignment = load_assignment(conn, assignment_id)?;
            if assignment.status != AssignmentStatus::Published {
                return Err(HostError::BadRequest(
                    "This assignment is not accepting submissions.".into(),
                ));
            }
            assert_enrolled(conn, assignment.classroom_id, student_id)?;

            let now = Utc::now();
            let late = assignment.due_at.is_some_and(|due| now > due);
            let existing = conn
                .query_row(
                    "SELECT id, status FROM submissions
                      WHERE assignment_id = ?1 AND student_id = ?2",
                    rusqlite::params![assignment_id.to_string(), student_id.to_string()],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let (submission_id, status) = match existing {
                Some((id, _)) => (parse_uuid(&id, "submission")?, SubmissionStatus::Resubmitted),
                None => (Uuid::new_v4(), SubmissionStatus::Submitted),
            };
            let next_version: i64 = conn.query_row(
                "SELECT coalesce(max(v.version_number), 0) + 1
                   FROM submission_versions v
                  WHERE v.submission_id = ?1",
                [submission_id.to_string()],
                |row| row.get(0),
            )?;
            let version_id = Uuid::new_v4();
            let doc_json = serde_json::to_string(&req.doc_json)
                .map_err(|error| HostError::BadRequest(format!("Invalid document: {error}")))?;

            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO submissions
                    (id, assignment_id, student_id, status, current_version_id, submitted_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(assignment_id, student_id) DO UPDATE SET
                    status = excluded.status,
                    current_version_id = excluded.current_version_id,
                    submitted_at = excluded.submitted_at,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    submission_id.to_string(),
                    assignment_id.to_string(),
                    student_id.to_string(),
                    status.as_str(),
                    version_id.to_string(),
                    now.to_rfc3339(),
                ],
            )?;
            tx.execute(
                "INSERT INTO submission_versions
                    (id, submission_id, version_number, doc_json, plaintext, change_note, late, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    version_id.to_string(),
                    submission_id.to_string(),
                    next_version,
                    doc_json,
                    req.plaintext,
                    req.change_note,
                    late,
                    now.to_rfc3339(),
                ],
            )?;
            tx.execute(
                "INSERT INTO change_events (entity_type, entity_id, user_id, changed_at)
                 VALUES ('submission', ?1, ?2, ?3)",
                rusqlite::params![submission_id.to_string(), student_id.to_string(), now.to_rfc3339()],
            )?;
            if status == SubmissionStatus::Resubmitted {
                tx.execute(
                    "UPDATE grades SET published = 0, updated_at = ?2 WHERE submission_id = ?1",
                    rusqlite::params![submission_id.to_string(), now.to_rfc3339()],
                )?;
            }
            tx.commit()?;
            load_submission(conn, submission_id, &student).map(Json)
        })
        .await
}

async fn get_my_submission(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(assignment_id): Path<Uuid>,
) -> HostResult<Json<Option<Submission>>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    state
        .db(move |conn| {
            let id: Option<String> = conn
                .query_row(
                    "SELECT id FROM submissions WHERE assignment_id = ?1 AND student_id = ?2",
                    rusqlite::params![assignment_id.to_string(), student_id.to_string()],
                    |row| row.get(0),
                )
                .optional()?;
            let submission = id
                .map(|id| load_submission(conn, parse_uuid(&id, "submission")?, &student))
                .transpose()?;
            Ok(Json(submission))
        })
        .await
}

async fn withdraw_work(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(assignment_id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    state
        .db(move |conn| {
            let changed = conn.execute(
                "UPDATE submissions SET status = 'withdrawn', updated_at = ?3
                  WHERE assignment_id = ?1 AND student_id = ?2 AND status <> 'withdrawn'",
                rusqlite::params![
                    assignment_id.to_string(),
                    student_id.to_string(),
                    Utc::now().to_rfc3339()
                ],
            )?;
            if changed == 0 {
                return Err(HostError::NotFound("submission"));
            }
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

async fn list_submissions(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(assignment_id): Path<Uuid>,
) -> HostResult<Json<Vec<Submission>>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            load_assignment(conn, assignment_id)?;
            let mut stmt = conn.prepare(
                "SELECT id FROM submissions
                  WHERE assignment_id = ?1 AND status <> 'withdrawn'
                  ORDER BY updated_at DESC",
            )?;
            let ids = stmt
                .query_map([assignment_id.to_string()], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let submissions = ids
                .iter()
                .map(|id| load_submission(conn, parse_uuid(id, "submission")?, &teacher))
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(submissions))
        })
        .await
}

async fn get_submission(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<Submission>> {
    state
        .db(move |conn| load_submission(conn, id, &user).map(Json))
        .await
}

async fn save_grade(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<SaveGradeRequest>,
) -> HostResult<Json<Grade>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let assignment_max: f64 = conn
                .query_row(
                    "SELECT a.max_points
                       FROM submissions s JOIN assignments a ON a.id = s.assignment_id
                      WHERE s.id = ?1",
                    [submission_id.to_string()],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or(HostError::NotFound("submission"))?;
            if let Some(points) = req.points {
                if !points.is_finite() || points < 0.0 || points > assignment_max {
                    return Err(HostError::BadRequest(format!(
                        "Points must be between 0 and {assignment_max}."
                    )));
                }
            }

            let now = Utc::now();
            let previous: Option<(String, Option<f64>, Option<String>, String, bool, String)> =
                conn.query_row(
                    "SELECT id, points, grade_label, feedback, published, updated_at
                       FROM grades WHERE submission_id = ?1",
                    [submission_id.to_string()],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                        ))
                    },
                )
                .optional()?;
            let grade_id = previous
                .as_ref()
                .map(|row| parse_uuid(&row.0, "grade"))
                .transpose()?
                .unwrap_or_else(Uuid::new_v4);
            let previous_json = previous
                .as_ref()
                .map(|row| {
                    serde_json::json!({
                        "points": row.1,
                        "grade_label": row.2,
                        "feedback": row.3,
                        "published": row.4,
                        "updated_at": row.5,
                    })
                })
                .unwrap_or(serde_json::Value::Null);
            let current_json = serde_json::json!({
                "points": req.points,
                "grade_label": req.grade_label,
                "feedback": req.feedback,
                "published": req.publish,
                "updated_at": now,
            });

            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO grades
                    (id, submission_id, points, grade_label, feedback, published, graded_by,
                     created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                 ON CONFLICT(submission_id) DO UPDATE SET
                    points = excluded.points,
                    grade_label = excluded.grade_label,
                    feedback = excluded.feedback,
                    published = excluded.published,
                    graded_by = excluded.graded_by,
                    updated_at = excluded.updated_at",
                rusqlite::params![
                    grade_id.to_string(),
                    submission_id.to_string(),
                    req.points,
                    req.grade_label,
                    req.feedback,
                    req.publish,
                    teacher_id.to_string(),
                    now.to_rfc3339(),
                ],
            )?;
            tx.execute(
                "INSERT INTO grade_changes
                    (id, grade_id, changed_by, previous_json, current_json, changed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    grade_id.to_string(),
                    teacher_id.to_string(),
                    previous_json.to_string(),
                    current_json.to_string(),
                    now.to_rfc3339(),
                ],
            )?;
            if req.publish {
                tx.execute(
                    "UPDATE submissions SET status = 'graded', updated_at = ?2 WHERE id = ?1",
                    rusqlite::params![submission_id.to_string(), now.to_rfc3339()],
                )?;
            }
            tx.commit()?;

            Ok(Json(Grade {
                id: grade_id,
                points: req.points,
                grade_label: req.grade_label,
                feedback: req.feedback,
                published: req.publish,
                updated_at: now,
            }))
        })
        .await
}

async fn list_comments(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(submission_id): Path<Uuid>,
) -> HostResult<Json<Vec<SubmissionComment>>> {
    state
        .db(move |conn| {
            assert_submission_visible(conn, submission_id, &user)?;
            let mut sql = String::from(
                "SELECT c.id, u.display_name, c.body, c.anchor_json, c.created_at
                   FROM submission_comments c JOIN users u ON u.id = c.author_id
                  WHERE c.submission_id = ?1",
            );
            if !user.0.role.is_teacher() {
                sql.push_str(" AND c.visible_to_student = 1");
            }
            sql.push_str(" ORDER BY c.created_at");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map([submission_id.to_string()], |row| {
                    let id: String = row.get(0)?;
                    let anchor: Option<String> = row.get(3)?;
                    let created_at: String = row.get(4)?;
                    Ok((id, row.get(1)?, row.get(2)?, anchor, created_at))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let comments = rows
                .into_iter()
                .map(|row| {
                    Ok(SubmissionComment {
                        id: parse_uuid(&row.0, "comment")?,
                        author_name: row.1,
                        body: row.2,
                        anchor: row
                            .3
                            .map(|value| serde_json::from_str(&value))
                            .transpose()
                            .map_err(|error| {
                                HostError::Other(anyhow::anyhow!("bad comment anchor: {error}"))
                            })?,
                        created_at: parse_time(&row.4)?,
                    })
                })
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(comments))
        })
        .await
}

async fn add_comment(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<AddCommentRequest>,
) -> HostResult<Json<SubmissionComment>> {
    teacher.require_teacher()?;
    if req.body.trim().is_empty() {
        return Err(HostError::BadRequest("Comment cannot be empty.".into()));
    }
    let teacher_id = teacher.id();
    let teacher_name = teacher.0.display_name.clone();
    state
        .db(move |conn| {
            assert_submission_visible(conn, submission_id, &teacher)?;
            let id = Uuid::new_v4();
            let now = Utc::now();
            let anchor_json = req
                .anchor
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|error| {
                    HostError::BadRequest(format!("Invalid comment anchor: {error}"))
                })?;
            conn.execute(
                "INSERT INTO submission_comments
                    (id, submission_id, author_id, body, anchor_json, visible_to_student,
                     created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
                rusqlite::params![
                    id.to_string(),
                    submission_id.to_string(),
                    teacher_id.to_string(),
                    req.body.trim(),
                    anchor_json,
                    now.to_rfc3339(),
                ],
            )?;
            Ok(Json(SubmissionComment {
                id,
                author_name: teacher_name,
                body: req.body.trim().to_owned(),
                anchor: req.anchor,
                created_at: now,
            }))
        })
        .await
}

async fn grade_history(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(submission_id): Path<Uuid>,
) -> HostResult<Json<Vec<GradeChange>>> {
    teacher.require_teacher()?;
    state
        .db(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT h.id, h.previous_json, h.current_json, h.changed_at
                   FROM grade_changes h JOIN grades g ON g.id = h.grade_id
                  WHERE g.submission_id = ?1 ORDER BY h.changed_at DESC",
            )?;
            let rows = stmt
                .query_map([submission_id.to_string()], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let history = rows
                .into_iter()
                .map(|row| {
                    Ok(GradeChange {
                        id: parse_uuid(&row.0, "grade change")?,
                        previous: serde_json::from_str(&row.1).map_err(|error| {
                            HostError::Other(anyhow::anyhow!("bad grade history: {error}"))
                        })?,
                        current: serde_json::from_str(&row.2).map_err(|error| {
                            HostError::Other(anyhow::anyhow!("bad grade history: {error}"))
                        })?,
                        changed_at: parse_time(&row.3)?,
                    })
                })
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(history))
        })
        .await
}

fn load_assignment(conn: &rusqlite::Connection, id: Uuid) -> HostResult<Assignment> {
    conn.query_row(
        "SELECT a.id, a.classroom_id, c.name, a.title, a.instructions, a.due_at,
                a.max_points, a.grading_scheme_json, a.status, a.created_at, a.updated_at
           FROM assignments a JOIN classrooms c ON c.id = a.classroom_id
          WHERE a.id = ?1 AND a.archived_at IS NULL AND c.archived_at IS NULL",
        [id.to_string()],
        assignment_row,
    )
    .optional()?
    .ok_or(HostError::NotFound("assignment"))?
}

fn assignment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HostResult<Assignment>> {
    let id: String = row.get(0)?;
    let classroom_id: String = row.get(1)?;
    let due_at: Option<String> = row.get(5)?;
    let grading: String = row.get(7)?;
    let status: String = row.get(8)?;
    let created_at: String = row.get(9)?;
    let updated_at: String = row.get(10)?;
    Ok((|| {
        Ok(Assignment {
            id: parse_uuid(&id, "assignment")?,
            classroom_id: parse_uuid(&classroom_id, "classroom")?,
            classroom_name: row.get(2)?,
            title: row.get(3)?,
            instructions: row.get(4)?,
            due_at: due_at.map(|value| parse_time(&value)).transpose()?,
            max_points: row.get(6)?,
            grading_scheme: serde_json::from_str(&grading).map_err(|error| {
                HostError::Other(anyhow::anyhow!("bad grading scheme: {error}"))
            })?,
            status: status
                .parse()
                .map_err(|error| HostError::Other(anyhow::anyhow!("{error}")))?,
            created_at: parse_time(&created_at)?,
            updated_at: parse_time(&updated_at)?,
        })
    })())
}

fn assert_assignment_visible(
    conn: &rusqlite::Connection,
    user: &CurrentUser,
    assignment: &Assignment,
) -> HostResult<()> {
    if user.0.role.is_teacher() {
        return Ok(());
    }
    if assignment.status == AssignmentStatus::Draft {
        return Err(HostError::Forbidden);
    }
    assert_enrolled(conn, assignment.classroom_id, user.id())
}

fn assert_enrolled(conn: &rusqlite::Connection, classroom: Uuid, student: Uuid) -> HostResult<()> {
    let enrolled: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM classroom_enrolments WHERE classroom_id = ?1 AND student_id = ?2
        )",
        rusqlite::params![classroom.to_string(), student.to_string()],
        |row| row.get(0),
    )?;
    if enrolled {
        Ok(())
    } else {
        Err(HostError::Forbidden)
    }
}

fn assert_submission_visible(
    conn: &rusqlite::Connection,
    submission_id: Uuid,
    user: &CurrentUser,
) -> HostResult<()> {
    if user.0.role.is_teacher() {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM submissions WHERE id = ?1)",
            [submission_id.to_string()],
            |row| row.get(0),
        )?;
        return if exists {
            Ok(())
        } else {
            Err(HostError::NotFound("submission"))
        };
    }
    let owner: Option<String> = conn
        .query_row(
            "SELECT student_id FROM submissions WHERE id = ?1",
            [submission_id.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    if owner.as_deref() == Some(user.id().to_string().as_str()) {
        Ok(())
    } else {
        Err(HostError::Forbidden)
    }
}

fn load_submission(
    conn: &rusqlite::Connection,
    id: Uuid,
    viewer: &CurrentUser,
) -> HostResult<Submission> {
    assert_submission_visible(conn, id, viewer)?;
    let row = conn
        .query_row(
            "SELECT s.id, s.assignment_id, a.title, s.student_id, u.display_name, s.status,
                    s.current_version_id, s.submitted_at, s.updated_at
               FROM submissions s
               JOIN assignments a ON a.id = s.assignment_id
               JOIN users u ON u.id = s.student_id
              WHERE s.id = ?1",
            [id.to_string()],
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
                    row.get::<_, String>(8)?,
                ))
            },
        )
        .optional()?
        .ok_or(HostError::NotFound("submission"))?;

    let version = row
        .6
        .as_deref()
        .map(|version_id| load_version(conn, version_id))
        .transpose()?;
    let grade = load_grade(conn, id, viewer.0.role.is_teacher())?;
    Ok(Submission {
        id: parse_uuid(&row.0, "submission")?,
        assignment_id: parse_uuid(&row.1, "assignment")?,
        assignment_title: row.2,
        student_id: parse_uuid(&row.3, "student")?,
        student_name: row.4,
        status: row
            .5
            .parse()
            .map_err(|error| HostError::Other(anyhow::anyhow!("{error}")))?,
        version,
        grade,
        submitted_at: row.7.map(|value| parse_time(&value)).transpose()?,
        updated_at: parse_time(&row.8)?,
    })
}

fn load_version(conn: &rusqlite::Connection, id: &str) -> HostResult<SubmissionVersion> {
    let row = conn.query_row(
        "SELECT id, version_number, doc_json, plaintext, change_note, late, created_at
           FROM submission_versions WHERE id = ?1",
        [id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, String>(6)?,
            ))
        },
    )?;
    Ok(SubmissionVersion {
        id: parse_uuid(&row.0, "submission version")?,
        version_number: row.1,
        doc_json: serde_json::from_str(&row.2)
            .map_err(|error| HostError::Other(anyhow::anyhow!("bad submission: {error}")))?,
        plaintext: row.3,
        change_note: row.4,
        late: row.5,
        created_at: parse_time(&row.6)?,
    })
}

fn load_grade(
    conn: &rusqlite::Connection,
    submission_id: Uuid,
    teacher: bool,
) -> HostResult<Option<Grade>> {
    let mut sql = String::from(
        "SELECT id, points, grade_label, feedback, published, updated_at
           FROM grades WHERE submission_id = ?1",
    );
    if !teacher {
        sql.push_str(" AND published = 1");
    }
    let row = conn
        .query_row(&sql, [submission_id.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .optional()?;
    row.map(|row| {
        Ok(Grade {
            id: parse_uuid(&row.0, "grade")?,
            points: row.1,
            grade_label: row.2,
            feedback: row.3,
            published: row.4,
            updated_at: parse_time(&row.5)?,
        })
    })
    .transpose()
}

fn parse_uuid(value: &str, what: &str) -> HostResult<Uuid> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad {what} id: {error}")))
}

fn parse_time(value: &str) -> HostResult<DateTime<Utc>> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad timestamp: {error}")))
}
