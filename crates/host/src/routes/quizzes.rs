//! Versioned quizzes. Answer keys stay in version rows and are stripped from every student response until release.

use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use cinder_core::{
    DeliverQuizRequest, GradeQuizResponseRequest, Quiz, QuizAttempt, QuizDelivery,
    QuizDeliveryKind, QuizQuestion, QuizQuestionInput, QuizQuestionKind, QuizQuestionStatistic,
    QuizResponse, QuizStatistics, SaveQuizRequest, SaveQuizResponseRequest, StudentQuizQuestion,
};
use rusqlite::{OptionalExtension, Transaction};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::routes::classrooms::require_teacher_access;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/quizzes", get(list_quizzes).post(create_quiz))
        .route(
            "/api/quizzes/{id}",
            get(get_quiz).patch(update_quiz).delete(archive_quiz),
        )
        .route("/api/quizzes/{id}/duplicate", post(duplicate_quiz))
        .route("/api/quizzes/{id}/publish", post(publish_quiz))
        .route("/api/quizzes/{id}/deliver", post(deliver_quiz))
        .route("/api/quiz-deliveries", get(list_deliveries))
        .route("/api/quiz-deliveries/{id}/start", post(start_attempt))
        .route("/api/quiz-deliveries/{id}/attempts", get(list_attempts))
        .route("/api/quiz-deliveries/{id}/release", post(release_results))
        .route("/api/quiz-deliveries/{id}/stats", get(statistics))
        .route("/api/quiz-attempts/{id}", get(get_attempt))
        .route(
            "/api/quiz-attempts/{id}/responses/{question_id}",
            put(save_response),
        )
        .route("/api/quiz-attempts/{id}/submit", post(submit_attempt))
        .route("/api/quiz-attempts/{id}/reopen", post(reopen_attempt))
        .route(
            "/api/quiz-attempts/{id}/responses/{question_id}/grade",
            put(grade_response),
        )
}

#[derive(Deserialize)]
struct ClassroomQuery {
    classroom_id: Option<Uuid>,
}

async fn list_quizzes(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Query(q): Query<ClassroomQuery>,
) -> HostResult<Json<Vec<Quiz>>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state.db(move |conn| {
        let ids = if let Some(classroom_id) = q.classroom_id {
            require_teacher_access(conn, classroom_id, teacher_id)?;
            let mut stmt = conn.prepare("SELECT id FROM quizzes WHERE classroom_id=?1 AND archived_at IS NULL ORDER BY updated_at DESC")?;
            let rows = stmt.query_map([classroom_id.to_string()], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        } else {
            let mut stmt = conn.prepare("SELECT q.id FROM quizzes q WHERE q.archived_at IS NULL AND (EXISTS(SELECT 1 FROM classrooms c WHERE c.id=q.classroom_id AND c.owner_teacher_id=?1) OR EXISTS(SELECT 1 FROM classroom_teachers ct WHERE ct.classroom_id=q.classroom_id AND ct.teacher_id=?1)) ORDER BY q.updated_at DESC")?;
            let rows = stmt.query_map([teacher_id.to_string()], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        Ok(Json(ids.into_iter().map(|id| load_quiz(conn, parse_uuid(&id)?)).collect::<HostResult<Vec<_>>>()?))
    }).await
}

async fn get_quiz(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<Quiz>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let quiz = load_quiz(conn, id)?;
            require_teacher_access(conn, quiz.classroom_id, teacher_id)?;
            Ok(Json(quiz))
        })
        .await
}

async fn create_quiz(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Json(req): Json<SaveQuizRequest>,
) -> HostResult<Json<Quiz>> {
    teacher.require_teacher()?;
    validate_quiz(&req)?;
    let teacher_id = teacher.id();
    state.db(move |conn| {
        require_teacher_access(conn, req.classroom_id, teacher_id)?;
        let id=Uuid::new_v4(); let now=Utc::now().to_rfc3339(); let tx=conn.transaction()?;
        tx.execute("INSERT INTO quizzes(id,classroom_id,title,instructions,time_limit_minutes,created_by,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)", rusqlite::params![id.to_string(),req.classroom_id.to_string(),req.title.trim(),req.instructions.trim(),req.time_limit_minutes,teacher_id.to_string(),now])?;
        replace_draft_questions(&tx,id,&req.questions)?; audit(&tx,teacher_id,"quiz_created",Some(id),None,None)?; tx.commit()?;
        Ok(Json(load_quiz(conn,id)?))
    }).await
}

async fn update_quiz(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<SaveQuizRequest>,
) -> HostResult<Json<Quiz>> {
    teacher.require_teacher()?;
    validate_quiz(&req)?;
    let teacher_id = teacher.id();
    state.db(move |conn| {
        let old=load_quiz(conn,id)?; require_active_quiz(&old)?; require_teacher_access(conn,old.classroom_id,teacher_id)?;
        if old.classroom_id != req.classroom_id { require_teacher_access(conn,req.classroom_id,teacher_id)?; }
        let tx=conn.transaction()?;
        tx.execute("UPDATE quizzes SET classroom_id=?2,title=?3,instructions=?4,time_limit_minutes=?5,updated_at=?6 WHERE id=?1 AND archived_at IS NULL",rusqlite::params![id.to_string(),req.classroom_id.to_string(),req.title.trim(),req.instructions.trim(),req.time_limit_minutes,Utc::now().to_rfc3339()])?;
        replace_draft_questions(&tx,id,&req.questions)?; audit(&tx,teacher_id,"quiz_updated",Some(id),None,None)?; tx.commit()?; Ok(Json(load_quiz(conn,id)?))
    }).await
}

async fn archive_quiz(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            let q = load_quiz(conn, id)?;
            require_teacher_access(conn, q.classroom_id, teacher_id)?;
            conn.execute(
                "UPDATE quizzes SET archived_at=?2,updated_at=?2 WHERE id=?1",
                rusqlite::params![id.to_string(), Utc::now().to_rfc3339()],
            )?;
            audit(conn, teacher_id, "quiz_archived", Some(id), None, None)?;
            Ok(Json(serde_json::json!({"ok":true})))
        })
        .await
}

async fn duplicate_quiz(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<Quiz>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state.db(move |conn| {
        let source=load_quiz(conn,id)?; require_active_quiz(&source)?; require_teacher_access(conn,source.classroom_id,teacher_id)?; let new_id=Uuid::new_v4(); let now=Utc::now().to_rfc3339(); let tx=conn.transaction()?;
        tx.execute("INSERT INTO quizzes(id,classroom_id,title,instructions,time_limit_minutes,created_by,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",rusqlite::params![new_id.to_string(),source.classroom_id.to_string(),format!("{} copy",source.title),source.instructions,source.time_limit_minutes,teacher_id.to_string(),now])?;
        let inputs=source.questions.into_iter().map(|q| QuizQuestionInput{id:None,kind:q.kind,prompt:q.prompt,options:q.options,canonical_answer:q.canonical_answer,max_points:q.max_points,required:q.required}).collect::<Vec<_>>();
        replace_draft_questions(&tx,new_id,&inputs)?; audit(&tx,teacher_id,"quiz_duplicated",Some(new_id),None,None)?; tx.commit()?; Ok(Json(load_quiz(conn,new_id)?))
    }).await
}

async fn publish_quiz(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<Quiz>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state.db(move |conn| {
        let quiz=load_quiz(conn,id)?; require_active_quiz(&quiz)?; require_teacher_access(conn,quiz.classroom_id,teacher_id)?;
        validate_quiz(&SaveQuizRequest{classroom_id:quiz.classroom_id,title:quiz.title.clone(),instructions:quiz.instructions.clone(),time_limit_minutes:quiz.time_limit_minutes,questions:quiz.questions.iter().map(|q| QuizQuestionInput{id:Some(q.id),kind:q.kind,prompt:q.prompt.clone(),options:q.options.clone(),canonical_answer:q.canonical_answer.clone(),max_points:q.max_points,required:q.required}).collect()})?;
        let tx=conn.transaction()?; let version:i64=tx.query_row("SELECT coalesce(max(version_number),0)+1 FROM quiz_versions WHERE quiz_id=?1",[id.to_string()],|r|r.get(0))?; let version_id=Uuid::new_v4(); let total:f64=quiz.questions.iter().map(|q|q.max_points).sum();
        tx.execute("INSERT INTO quiz_versions(id,quiz_id,version_number,title,instructions,time_limit_minutes,total_points,published_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",rusqlite::params![version_id.to_string(),id.to_string(),version,quiz.title,quiz.instructions,quiz.time_limit_minutes,total,Utc::now().to_rfc3339()])?;
        for q in quiz.questions { tx.execute("INSERT INTO quiz_version_questions(id,version_id,position,kind,prompt,options_json,canonical_answer_json,max_points,required) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",rusqlite::params![Uuid::new_v4().to_string(),version_id.to_string(),q.position,q.kind.as_str(),q.prompt,serde_json::to_string(&q.options).unwrap(),serde_json::to_string(&q.canonical_answer).unwrap(),q.max_points,q.required])?; }
        audit(&tx,teacher_id,"quiz_published",Some(id),None,None)?; tx.commit()?; Ok(Json(load_quiz(conn,id)?))
    }).await
}

async fn deliver_quiz(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
    Json(req): Json<DeliverQuizRequest>,
) -> HostResult<Json<QuizDelivery>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state.db(move |conn| {
        let quiz=load_quiz(conn,id)?; require_active_quiz(&quiz)?; require_teacher_access(conn,quiz.classroom_id,teacher_id)?;
        if req.due_at.zip(req.opens_at).is_some_and(|(due,open)| due<=open) { return Err(HostError::BadRequest("Due time must be after opening time.".into())); }
        let version_id:String=conn.query_row("SELECT id FROM quiz_versions WHERE quiz_id=?1 ORDER BY version_number DESC LIMIT 1",[id.to_string()],|r|r.get(0)).optional()?.ok_or_else(||HostError::BadRequest("Publish the quiz before assigning it.".into()))?;
        if req.kind==QuizDeliveryKind::Live {
            let live=req.live_session_id.ok_or_else(||HostError::BadRequest("Choose an active live session.".into()))?;
            let valid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM live_module_sessions WHERE id=?1 AND classroom_id=?2 AND ended_at IS NULL AND ends_at>?3)",rusqlite::params![live.to_string(),quiz.classroom_id.to_string(),Utc::now().to_rfc3339()],|r|r.get(0))?;
            if !valid { return Err(HostError::BadRequest("The live session is not active in this classroom.".into())); }
        } else if req.live_session_id.is_some() { return Err(HostError::BadRequest("Homework cannot reference a live session.".into())); }
        let assigned_count:i64=conn.query_row("SELECT count(*) FROM classroom_enrolments WHERE classroom_id=?1",[quiz.classroom_id.to_string()],|r|r.get(0))?;
        let delivery_id=Uuid::new_v4(); conn.execute("INSERT INTO quiz_deliveries(id,version_id,classroom_id,kind,live_session_id,opens_at,due_at,created_by,created_at,assigned_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",rusqlite::params![delivery_id.to_string(),version_id,quiz.classroom_id.to_string(),req.kind.as_str(),req.live_session_id.map(|v|v.to_string()),req.opens_at.map(|v|v.to_rfc3339()),req.due_at.map(|v|v.to_rfc3339()),teacher_id.to_string(),Utc::now().to_rfc3339(),assigned_count])?;
        audit(conn,teacher_id,"quiz_delivered",Some(id),Some(delivery_id),None)?; Ok(Json(load_delivery(conn,delivery_id,None)?))
    }).await
}

async fn list_deliveries(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(q): Query<ClassroomQuery>,
) -> HostResult<Json<Vec<QuizDelivery>>> {
    let user_id = user.id();
    let teacher = user.0.role.is_teacher();
    state.db(move |conn| {
        let mut sql=String::from("SELECT d.id FROM quiz_deliveries d WHERE 1=1"); let mut params=Vec::<String>::new();
        if let Some(cid)=q.classroom_id { params.push(cid.to_string()); sql.push_str(&format!(" AND d.classroom_id=?{}",params.len())); if teacher { require_teacher_access(conn,cid,user_id)?; } }
        if teacher { params.push(user_id.to_string()); sql.push_str(&format!(" AND (EXISTS(SELECT 1 FROM classrooms c WHERE c.id=d.classroom_id AND c.owner_teacher_id=?{0}) OR EXISTS(SELECT 1 FROM classroom_teachers ct WHERE ct.classroom_id=d.classroom_id AND ct.teacher_id=?{0}))",params.len())); }
        else { params.push(user_id.to_string()); sql.push_str(&format!(" AND EXISTS(SELECT 1 FROM classroom_enrolments e WHERE e.classroom_id=d.classroom_id AND e.student_id=?{})",params.len())); }
        sql.push_str(" ORDER BY d.created_at DESC"); let mut stmt=conn.prepare(&sql)?; let ids=stmt.query_map(rusqlite::params_from_iter(params),|r|r.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
        Ok(Json(ids.into_iter().map(|id|load_delivery(conn,parse_uuid(&id)?,if teacher{None}else{Some(user_id)})).collect::<HostResult<Vec<_>>>()?))
    }).await
}

async fn start_attempt(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<QuizAttempt>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let student_id = student.id();
    state.db(move |conn| {
        let delivery=load_delivery(conn,id,Some(student_id))?; let now=Utc::now();
        if delivery.results_released_at.is_some() { return Err(HostError::Conflict); }
        let enrolled: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM classroom_enrolments WHERE classroom_id=?1 AND student_id=?2)", rusqlite::params![delivery.classroom_id.to_string(), student_id.to_string()], |row| row.get(0))?;
        if !enrolled { return Err(HostError::Forbidden); }
        if delivery.opens_at.is_some_and(|v|v>now) || delivery.due_at.is_some_and(|v|v<=now) { return Err(HostError::Conflict); }
        let live_end = active_live_deadline(conn, id, student_id, now)?;
        let existing:Option<String>=conn.query_row("SELECT id FROM quiz_attempts WHERE delivery_id=?1 AND student_id=?2",rusqlite::params![id.to_string(),student_id.to_string()],|r|r.get(0)).optional()?;
        let attempt_id=if let Some(value)=existing { parse_uuid(&value)? } else { let aid=Uuid::new_v4(); let expires=[delivery.time_limit_minutes.map(|m|now+Duration::minutes(i64::from(m))),delivery.due_at,live_end].into_iter().flatten().min(); conn.execute("INSERT INTO quiz_attempts(id,delivery_id,student_id,started_at,expires_at,max_points) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![aid.to_string(),id.to_string(),student_id.to_string(),now.to_rfc3339(),expires.map(|v|v.to_rfc3339()),delivery.total_points])?; aid};
        Ok(Json(load_attempt(conn,attempt_id,&student,false)?))
    }).await
}

async fn get_attempt(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<QuizAttempt>> {
    state
        .db(move |conn| {
            Ok(Json(load_attempt(
                conn,
                id,
                &user,
                user.0.role.is_teacher(),
            )?))
        })
        .await
}

async fn list_attempts(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<Vec<QuizAttempt>>> {
    teacher.require_teacher()?;
    let teacher_id = teacher.id();
    state
        .db(move |conn| {
            require_teacher_access(conn, delivery_classroom(conn, id)?, teacher_id)?;
            let mut stmt = conn
                .prepare("SELECT id FROM quiz_attempts WHERE delivery_id=?1 ORDER BY started_at")?;
            let ids = stmt
                .query_map([id.to_string()], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Json(
                ids.into_iter()
                    .map(|value| load_attempt(conn, parse_uuid(&value)?, &teacher, true))
                    .collect::<HostResult<Vec<_>>>()?,
            ))
        })
        .await
}

async fn save_response(
    State(state): State<AppState>,
    student: CurrentUser,
    Path((id, question_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<SaveQuizResponseRequest>,
) -> HostResult<Json<QuizResponse>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let sid = student.id();
    state.db(move|conn|{
        ensure_attempt_writable(conn,id,sid)?; let (kind,key,max)=question_key(conn,id,question_id)?; let (points,auto)=objective_points(kind,&key,&req.answer,max); let now=Utc::now().to_rfc3339();
        conn.execute("INSERT INTO quiz_responses(id,attempt_id,question_id,answer_json,points,feedback,auto_graded,graded_at,updated_at) VALUES(?1,?2,?3,?4,?5,'',?6,?7,?7) ON CONFLICT(attempt_id,question_id) DO UPDATE SET answer_json=excluded.answer_json,points=excluded.points,feedback='',auto_graded=excluded.auto_graded,graded_at=excluded.graded_at,updated_at=excluded.updated_at",rusqlite::params![Uuid::new_v4().to_string(),id.to_string(),question_id.to_string(),serde_json::to_string(&req.answer).unwrap(),points,auto,if auto{Some(now.clone())}else{None},now])?;
        Ok(Json(load_response(conn,id,question_id,false)?))
    }).await
}

async fn submit_attempt(
    State(state): State<AppState>,
    student: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<QuizAttempt>> {
    if student.0.role.is_teacher() {
        return Err(HostError::Forbidden);
    }
    let sid = student.id();
    state.db(move|conn|{
        ensure_attempt_writable(conn,id,sid)?; let missing:i64=conn.query_row("SELECT count(*) FROM quiz_version_questions q JOIN quiz_deliveries d ON d.version_id=q.version_id JOIN quiz_attempts a ON a.delivery_id=d.id WHERE a.id=?1 AND q.required=1 AND NOT EXISTS(SELECT 1 FROM quiz_responses r WHERE r.attempt_id=a.id AND r.question_id=q.id AND r.answer_json NOT IN ('null','\"\"'))",[id.to_string()],|r|r.get(0))?; if missing>0{return Err(HostError::BadRequest(format!("Answer all required questions ({missing} remaining).")))}
        let now=Utc::now().to_rfc3339(); conn.execute("UPDATE quiz_attempts SET submitted_at=?2 WHERE id=?1",rusqlite::params![id.to_string(),now])?; recalculate_attempt(conn,id)?; Ok(Json(load_attempt(conn,id,&student,false)?))
    }).await
}

async fn reopen_attempt(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<QuizAttempt>> {
    teacher.require_teacher()?;
    let tid = teacher.id();
    state.db(move|conn|{ let classroom=attempt_classroom(conn,id)?; require_teacher_access(conn,classroom,tid)?; let now=Utc::now(); let (delivery_id,student_id,limit,due,released):(String,String,Option<u32>,Option<String>,Option<String>)=conn.query_row("SELECT d.id,a.student_id,v.time_limit_minutes,d.due_at,d.results_released_at FROM quiz_attempts a JOIN quiz_deliveries d ON d.id=a.delivery_id JOIN quiz_versions v ON v.id=d.version_id WHERE a.id=?1",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?; if released.is_some(){return Err(HostError::Conflict)} let delivery_id=parse_uuid(&delivery_id)?; let student_id=parse_uuid(&student_id)?; let live_end=active_live_deadline(conn,delivery_id,student_id,now)?; let due=parse_optional_time(due)?; let expires=[limit.map(|minutes|now+Duration::minutes(i64::from(minutes))),due,live_end].into_iter().flatten().min(); conn.execute("UPDATE quiz_attempts SET submitted_at=NULL,score=NULL,graded_at=NULL,reopened_at=?2,expires_at=?3 WHERE id=?1",rusqlite::params![id.to_string(),now.to_rfc3339(),expires.map(|value|value.to_rfc3339())])?; audit(conn,tid,"attempt_reopened",None,None,Some(id))?; Ok(Json(load_attempt(conn,id,&teacher,true)?)) }).await
}

async fn grade_response(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path((id, qid)): Path<(Uuid, Uuid)>,
    Json(req): Json<GradeQuizResponseRequest>,
) -> HostResult<Json<QuizAttempt>> {
    teacher.require_teacher()?;
    let tid = teacher.id();
    state.db(move|conn|{ let classroom=attempt_classroom(conn,id)?; require_teacher_access(conn,classroom,tid)?; let (kind,_,max)=question_key(conn,id,qid)?; if kind!=QuizQuestionKind::ShortAnswer{return Err(HostError::BadRequest("Only short answers require manual grading.".into()))} if !req.points.is_finite()||req.points<0.0||req.points>max{return Err(HostError::BadRequest(format!("Points must be between 0 and {max}.")))} let now=Utc::now().to_rfc3339(); let changed=conn.execute("UPDATE quiz_responses SET points=?3,feedback=?4,auto_graded=0,graded_at=?5,updated_at=?5 WHERE attempt_id=?1 AND question_id=?2",rusqlite::params![id.to_string(),qid.to_string(),req.points,req.feedback.trim(),now])?; if changed==0{return Err(HostError::NotFound("quiz response"))} recalculate_attempt(conn,id)?; audit(conn,tid,"response_graded",None,None,Some(id))?; Ok(Json(load_attempt(conn,id,&teacher,true)?)) }).await
}

async fn release_results(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<QuizDelivery>> {
    teacher.require_teacher()?;
    let tid = teacher.id();
    state.db(move|conn|{ let classroom=delivery_classroom(conn,id)?; require_teacher_access(conn,classroom,tid)?; let incomplete:i64=conn.query_row("SELECT count(*) FROM quiz_attempts a WHERE a.delivery_id=?1 AND a.submitted_at IS NOT NULL AND a.graded_at IS NULL",[id.to_string()],|r|r.get(0))?; if incomplete>0{return Err(HostError::BadRequest(format!("{incomplete} submitted attempt(s) still require grading.")))} conn.execute("UPDATE quiz_deliveries SET results_released_at=?2 WHERE id=?1",rusqlite::params![id.to_string(),Utc::now().to_rfc3339()])?; audit(conn,tid,"results_released",None,Some(id),None)?; Ok(Json(load_delivery(conn,id,None)?)) }).await
}

async fn statistics(
    State(state): State<AppState>,
    teacher: CurrentUser,
    Path(id): Path<Uuid>,
) -> HostResult<Json<QuizStatistics>> {
    teacher.require_teacher()?;
    let tid = teacher.id();
    state
        .db(move |conn| {
            let classroom = delivery_classroom(conn, id)?;
            require_teacher_access(conn, classroom, tid)?;
            Ok(Json(calculate_statistics(conn, id)?))
        })
        .await
}

fn validate_quiz(req: &SaveQuizRequest) -> HostResult<()> {
    if req.title.trim().is_empty() || req.title.chars().count() > 200 {
        return Err(HostError::BadRequest(
            "Quiz title must contain 1–200 characters.".into(),
        ));
    }
    if req.questions.is_empty() || req.questions.len() > 100 {
        return Err(HostError::BadRequest(
            "A quiz must contain 1–100 questions.".into(),
        ));
    }
    if req.time_limit_minutes.is_some_and(|m| m == 0 || m > 180) {
        return Err(HostError::BadRequest(
            "Time limit must be between 1 and 180 minutes.".into(),
        ));
    }
    for q in &req.questions {
        if q.prompt.trim().is_empty() || q.prompt.chars().count() > 2000 {
            return Err(HostError::BadRequest(
                "Every question needs a prompt of at most 2,000 characters.".into(),
            ));
        }
        if !q.max_points.is_finite() || q.max_points <= 0.0 || q.max_points > 1000.0 {
            return Err(HostError::BadRequest(
                "Question points must be greater than zero.".into(),
            ));
        }
        match q.kind {
            QuizQuestionKind::SingleChoice => {
                let answer = q.canonical_answer.as_str().ok_or_else(|| {
                    HostError::BadRequest("Single-choice answers must be option text.".into())
                })?;
                let unique = q
                    .options
                    .iter()
                    .map(|value| value.trim())
                    .collect::<std::collections::HashSet<_>>();
                if q.options.len() < 2
                    || q.options.len() > 10
                    || q.options.iter().any(|v| v.trim().is_empty())
                    || unique.len() != q.options.len()
                    || q.options.iter().filter(|v| v.as_str() == answer).count() != 1
                {
                    return Err(HostError::BadRequest("Single-choice questions need 2–10 unique options and one canonical answer.".into()));
                }
            }
            QuizQuestionKind::TrueFalse => {
                if !q.options.is_empty() || !q.canonical_answer.is_boolean() {
                    return Err(HostError::BadRequest(
                        "True/false questions need one boolean canonical answer.".into(),
                    ));
                }
            }
            QuizQuestionKind::ShortAnswer => {
                if !q.options.is_empty() {
                    return Err(HostError::BadRequest(
                        "Short-answer questions cannot have options.".into(),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn replace_draft_questions(
    tx: &Transaction<'_>,
    quiz_id: Uuid,
    questions: &[QuizQuestionInput],
) -> HostResult<()> {
    tx.execute(
        "DELETE FROM quiz_draft_questions WHERE quiz_id=?1",
        [quiz_id.to_string()],
    )?;
    for (position, q) in questions.iter().enumerate() {
        tx.execute("INSERT INTO quiz_draft_questions(id,quiz_id,position,kind,prompt,options_json,canonical_answer_json,max_points,required) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",rusqlite::params![q.id.unwrap_or_else(Uuid::new_v4).to_string(),quiz_id.to_string(),position as i64,q.kind.as_str(),q.prompt.trim(),serde_json::to_string(&q.options).unwrap(),serde_json::to_string(&q.canonical_answer).unwrap(),q.max_points,q.required])?;
    }
    Ok(())
}

fn load_quiz(conn: &rusqlite::Connection, id: Uuid) -> HostResult<Quiz> {
    let row=conn.query_row("SELECT q.classroom_id,c.name,q.title,q.instructions,q.time_limit_minutes,q.archived_at,q.updated_at,(SELECT max(version_number) FROM quiz_versions WHERE quiz_id=q.id) FROM quizzes q JOIN classrooms c ON c.id=q.classroom_id WHERE q.id=?1",[id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<u32>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,String>(6)?,r.get::<_,Option<u32>>(7)?))).optional()?.ok_or(HostError::NotFound("quiz"))?;
    let mut stmt=conn.prepare("SELECT id,position,kind,prompt,options_json,canonical_answer_json,max_points,required FROM quiz_draft_questions WHERE quiz_id=?1 ORDER BY position")?;
    let questions = stmt
        .query_map([id.to_string()], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, f64>(6)?,
                r.get::<_, bool>(7)?,
            ))
        })?
        .map(|v| {
            let v = v?;
            Ok(QuizQuestion {
                id: parse_uuid(&v.0)?,
                position: v.1,
                kind: v.2.parse().map_err(HostError::BadRequest)?,
                prompt: v.3,
                options: serde_json::from_str(&v.4).map_err(|e| HostError::Other(e.into()))?,
                canonical_answer: serde_json::from_str(&v.5)
                    .map_err(|e| HostError::Other(e.into()))?,
                max_points: v.6,
                required: v.7,
            })
        })
        .collect::<HostResult<Vec<_>>>()?;
    Ok(Quiz {
        id,
        classroom_id: parse_uuid(&row.0)?,
        classroom_name: row.1,
        title: row.2,
        instructions: row.3,
        time_limit_minutes: row.4,
        archived: row.5.is_some(),
        updated_at: parse_time(&row.6)?,
        published_version: row.7,
        questions,
    })
}

fn load_delivery(
    conn: &rusqlite::Connection,
    id: Uuid,
    student: Option<Uuid>,
) -> HostResult<QuizDelivery> {
    let row=conn.query_row("SELECT v.quiz_id,d.version_id,d.classroom_id,c.name,v.title,v.instructions,d.kind,v.time_limit_minutes,v.total_points,d.opens_at,d.due_at,d.results_released_at FROM quiz_deliveries d JOIN quiz_versions v ON v.id=d.version_id JOIN classrooms c ON c.id=d.classroom_id WHERE d.id=?1",[id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,Option<u32>>(7)?,r.get::<_,f64>(8)?,r.get::<_,Option<String>>(9)?,r.get::<_,Option<String>>(10)?,r.get::<_,Option<String>>(11)?))).optional()?.ok_or(HostError::NotFound("quiz delivery"))?;
    let attempt = if let Some(sid) = student {
        conn.query_row("SELECT id,CASE WHEN submitted_at IS NOT NULL THEN 'submitted' ELSE 'in_progress' END FROM quiz_attempts WHERE delivery_id=?1 AND student_id=?2",rusqlite::params![id.to_string(),sid.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?
    } else {
        None
    };
    Ok(QuizDelivery {
        id,
        quiz_id: parse_uuid(&row.0)?,
        version_id: parse_uuid(&row.1)?,
        classroom_id: parse_uuid(&row.2)?,
        classroom_name: row.3,
        title: row.4,
        instructions: row.5,
        kind: if row.6 == "live" {
            QuizDeliveryKind::Live
        } else {
            QuizDeliveryKind::Homework
        },
        time_limit_minutes: row.7,
        total_points: row.8,
        opens_at: parse_optional_time(row.9)?,
        due_at: parse_optional_time(row.10)?,
        results_released_at: parse_optional_time(row.11)?,
        attempt_id: attempt.as_ref().map(|v| v.0.clone()),
        attempt_state: attempt.map(|v| v.1),
    })
}

fn load_attempt(
    conn: &rusqlite::Connection,
    id: Uuid,
    user: &CurrentUser,
    teacher: bool,
) -> HostResult<QuizAttempt> {
    let row=conn.query_row("SELECT a.delivery_id,a.student_id,u.display_name,a.started_at,a.expires_at,a.submitted_at,a.score,a.max_points,a.graded_at,d.results_released_at FROM quiz_attempts a JOIN quiz_deliveries d ON d.id=a.delivery_id JOIN users u ON u.id=a.student_id WHERE a.id=?1",[id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<f64>>(6)?,r.get::<_,f64>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,Option<String>>(9)?))).optional()?.ok_or(HostError::NotFound("quiz attempt"))?;
    let delivery = load_delivery(
        conn,
        parse_uuid(&row.0)?,
        if teacher { None } else { Some(user.id()) },
    )?;
    if teacher {
        require_teacher_access(conn, delivery.classroom_id, user.id())?
    } else if row.1 != user.id().to_string() {
        return Err(HostError::Forbidden);
    }
    let released = row.9.is_some() && row.5.is_some();
    let mut stmt=conn.prepare("SELECT id,position,kind,prompt,options_json,max_points,required FROM quiz_version_questions WHERE version_id=?1 ORDER BY position")?;
    let questions = stmt
        .query_map([delivery.version_id.to_string()], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, f64>(5)?,
                r.get::<_, bool>(6)?,
            ))
        })?
        .map(|v| {
            let v = v?;
            Ok(StudentQuizQuestion {
                id: parse_uuid(&v.0)?,
                position: v.1,
                kind: v.2.parse().map_err(HostError::BadRequest)?,
                prompt: v.3,
                options: serde_json::from_str(&v.4).map_err(|e| HostError::Other(e.into()))?,
                max_points: v.5,
                required: v.6,
            })
        })
        .collect::<HostResult<Vec<_>>>()?;
    let mut responses = Vec::new();
    for question in &questions {
        match load_response(conn, id, question.id, released || teacher) {
            Ok(response) => responses.push(response),
            Err(HostError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(QuizAttempt {
        id,
        student_id: parse_uuid(&row.1)?,
        student_name: row.2,
        delivery,
        questions,
        responses,
        started_at: parse_time(&row.3)?,
        expires_at: parse_optional_time(row.4)?,
        submitted_at: parse_optional_time(row.5)?,
        score: if released || teacher { row.6 } else { None },
        max_points: row.7,
        manual_grading_complete: row.8.is_some(),
        released,
        server_now: Utc::now(),
    })
}

fn load_response(
    conn: &rusqlite::Connection,
    aid: Uuid,
    qid: Uuid,
    show_key: bool,
) -> HostResult<QuizResponse> {
    let row=conn.query_row("SELECT r.answer_json,r.points,r.feedback,q.max_points,q.canonical_answer_json FROM quiz_responses r JOIN quiz_version_questions q ON q.id=r.question_id WHERE r.attempt_id=?1 AND r.question_id=?2",rusqlite::params![aid.to_string(),qid.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<f64>>(1)?,r.get::<_,String>(2)?,r.get::<_,f64>(3)?,r.get::<_,String>(4)?))).optional()?.ok_or(HostError::NotFound("quiz response"))?;
    Ok(QuizResponse {
        question_id: qid,
        answer: serde_json::from_str(&row.0).map_err(|e| HostError::Other(e.into()))?,
        points: if show_key { row.1 } else { None },
        feedback: if show_key { row.2 } else { String::new() },
        correct: if show_key {
            row.1.map(|p| (p - row.3).abs() < f64::EPSILON)
        } else {
            None
        },
        canonical_answer: if show_key {
            Some(serde_json::from_str(&row.4).map_err(|e| HostError::Other(e.into()))?)
        } else {
            None
        },
    })
}

fn ensure_attempt_writable(conn: &rusqlite::Connection, id: Uuid, sid: Uuid) -> HostResult<()> {
    let row=conn.query_row("SELECT a.student_id,a.submitted_at,a.expires_at,d.due_at,d.results_released_at,d.id FROM quiz_attempts a JOIN quiz_deliveries d ON d.id=a.delivery_id WHERE a.id=?1",[id.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,String>(5)?))).optional()?.ok_or(HostError::NotFound("quiz attempt"))?;
    if row.0 != sid.to_string() {
        return Err(HostError::Forbidden);
    }
    if row.1.is_some() || row.4.is_some() {
        return Err(HostError::Conflict);
    }
    let now = Utc::now();
    active_live_deadline(conn, parse_uuid(&row.5)?, sid, now)?;
    if parse_optional_time(row.2)?.is_some_and(|v| v <= now)
        || parse_optional_time(row.3)?.is_some_and(|v| v <= now)
    {
        return Err(HostError::Conflict);
    }
    Ok(())
}

fn active_live_deadline(
    conn: &rusqlite::Connection,
    delivery_id: Uuid,
    student_id: Uuid,
    now: DateTime<Utc>,
) -> HostResult<Option<DateTime<Utc>>> {
    let row = conn
        .query_row(
            "SELECT d.kind,s.ends_at,s.ended_at,EXISTS(SELECT 1 FROM live_module_participants p WHERE p.session_id=s.id AND p.student_id=?2) FROM quiz_deliveries d LEFT JOIN live_module_sessions s ON s.id=d.live_session_id WHERE d.id=?1",
            rusqlite::params![delivery_id.to_string(), student_id.to_string()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, bool>(3)?)),
        )
        .optional()?
        .ok_or(HostError::NotFound("quiz delivery"))?;
    if row.0 != "live" {
        return Ok(None);
    }
    if !row.3 {
        return Err(HostError::Forbidden);
    }
    let ends_at = parse_optional_time(row.1)?.ok_or(HostError::Conflict)?;
    if row.2.is_some() || ends_at <= now {
        return Err(HostError::Conflict);
    }
    Ok(Some(ends_at))
}

fn require_active_quiz(quiz: &Quiz) -> HostResult<()> {
    if quiz.archived {
        Err(HostError::Conflict)
    } else {
        Ok(())
    }
}
fn question_key(
    conn: &rusqlite::Connection,
    aid: Uuid,
    qid: Uuid,
) -> HostResult<(QuizQuestionKind, serde_json::Value, f64)> {
    let r=conn.query_row("SELECT q.kind,q.canonical_answer_json,q.max_points FROM quiz_version_questions q JOIN quiz_deliveries d ON d.version_id=q.version_id JOIN quiz_attempts a ON a.delivery_id=d.id WHERE a.id=?1 AND q.id=?2",rusqlite::params![aid.to_string(),qid.to_string()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,f64>(2)?))).optional()?.ok_or(HostError::NotFound("quiz question"))?;
    Ok((
        r.0.parse().map_err(HostError::BadRequest)?,
        serde_json::from_str(&r.1).map_err(|e| HostError::Other(e.into()))?,
        r.2,
    ))
}
fn objective_points(
    kind: QuizQuestionKind,
    key: &serde_json::Value,
    answer: &serde_json::Value,
    max: f64,
) -> (Option<f64>, bool) {
    match kind {
        QuizQuestionKind::ShortAnswer => (None, false),
        _ => (Some(if key == answer { max } else { 0.0 }), true),
    }
}
fn recalculate_attempt(conn: &rusqlite::Connection, id: Uuid) -> HostResult<()> {
    let manual_missing:i64=conn.query_row("SELECT count(*) FROM quiz_version_questions q JOIN quiz_deliveries d ON d.version_id=q.version_id JOIN quiz_attempts a ON a.delivery_id=d.id WHERE a.id=?1 AND q.kind='short_answer' AND (q.required=1 OR EXISTS(SELECT 1 FROM quiz_responses answered WHERE answered.attempt_id=a.id AND answered.question_id=q.id)) AND NOT EXISTS(SELECT 1 FROM quiz_responses r WHERE r.attempt_id=a.id AND r.question_id=q.id AND r.graded_at IS NOT NULL)",[id.to_string()],|r|r.get(0))?;
    let score: f64 = conn.query_row(
        "SELECT coalesce(sum(points),0) FROM quiz_responses WHERE attempt_id=?1",
        [id.to_string()],
        |r| r.get(0),
    )?;
    conn.execute("UPDATE quiz_attempts SET score=?2,graded_at=CASE WHEN submitted_at IS NOT NULL AND ?3=0 THEN ?4 ELSE NULL END WHERE id=?1",rusqlite::params![id.to_string(),score,manual_missing,Utc::now().to_rfc3339()])?;
    Ok(())
}
fn delivery_classroom(conn: &rusqlite::Connection, id: Uuid) -> HostResult<Uuid> {
    let s = conn
        .query_row(
            "SELECT classroom_id FROM quiz_deliveries WHERE id=?1",
            [id.to_string()],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .ok_or(HostError::NotFound("quiz delivery"))?;
    parse_uuid(&s)
}
fn attempt_classroom(conn: &rusqlite::Connection, id: Uuid) -> HostResult<Uuid> {
    let s=conn.query_row("SELECT d.classroom_id FROM quiz_attempts a JOIN quiz_deliveries d ON d.id=a.delivery_id WHERE a.id=?1",[id.to_string()],|r|r.get::<_,String>(0)).optional()?.ok_or(HostError::NotFound("quiz attempt"))?;
    parse_uuid(&s)
}
fn audit(
    conn: &rusqlite::Connection,
    actor: Uuid,
    action: &str,
    quiz: Option<Uuid>,
    delivery: Option<Uuid>,
    attempt: Option<Uuid>,
) -> HostResult<()> {
    conn.execute("INSERT INTO quiz_audit_log(actor_id,action,quiz_id,delivery_id,attempt_id,created_at) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![actor.to_string(),action,quiz.map(|v|v.to_string()),delivery.map(|v|v.to_string()),attempt.map(|v|v.to_string()),Utc::now().to_rfc3339()])?;
    Ok(())
}
fn calculate_statistics(conn: &rusqlite::Connection, id: Uuid) -> HostResult<QuizStatistics> {
    let assigned:i64=conn.query_row("SELECT coalesce(assigned_count,(SELECT count(*) FROM classroom_enrolments WHERE classroom_id=quiz_deliveries.classroom_id)) FROM quiz_deliveries WHERE id=?1",[id.to_string()],|r|r.get(0))?;
    let started: i64 = conn.query_row(
        "SELECT count(*) FROM quiz_attempts WHERE delivery_id=?1",
        [id.to_string()],
        |r| r.get(0),
    )?;
    let submitted: i64 = conn.query_row(
        "SELECT count(*) FROM quiz_attempts WHERE delivery_id=?1 AND submitted_at IS NOT NULL",
        [id.to_string()],
        |r| r.get(0),
    )?;
    let mut stmt=conn.prepare("SELECT score FROM quiz_attempts WHERE delivery_id=?1 AND submitted_at IS NOT NULL AND graded_at IS NOT NULL ORDER BY score")?;
    let scores = stmt
        .query_map([id.to_string()], |r| r.get::<_, f64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let max_points:f64=conn.query_row("SELECT v.total_points FROM quiz_deliveries d JOIN quiz_versions v ON v.id=d.version_id WHERE d.id=?1",[id.to_string()],|r|r.get(0))?;
    let percentile = |p: f64| -> Option<f64> {
        if scores.is_empty() {
            return None;
        }
        let pos = p * (scores.len() - 1) as f64;
        let lo = pos.floor() as usize;
        let hi = pos.ceil() as usize;
        Some(scores[lo] + (scores[hi] - scores[lo]) * (pos - lo as f64))
    };
    let mut distribution = vec![0u32; 10];
    for s in &scores {
        let pct = if max_points > 0.0 {
            100.0 * s / max_points
        } else {
            0.0
        };
        let i = ((pct / 10.0).floor() as usize).min(9);
        distribution[i] += 1;
    }
    let version: String = conn.query_row(
        "SELECT version_id FROM quiz_deliveries WHERE id=?1",
        [id.to_string()],
        |r| r.get(0),
    )?;
    let mut qs=conn.prepare("SELECT id,prompt,max_points,kind FROM quiz_version_questions WHERE version_id=?1 ORDER BY position")?;
    let raw = qs
        .query_map([version], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut questions = Vec::new();
    for (qid, prompt, max, kind) in raw {
        let (g, c, p): (i64, i64, i64) = if kind == "short_answer" {
            conn.query_row("SELECT count(*),coalesce(sum(CASE WHEN abs(r.points-?3)<0.000001 THEN 1 ELSE 0 END),0),coalesce(sum(CASE WHEN r.points>0 AND r.points<?3 THEN 1 ELSE 0 END),0) FROM quiz_responses r JOIN quiz_attempts a ON a.id=r.attempt_id WHERE a.delivery_id=?1 AND r.question_id=?2 AND a.submitted_at IS NOT NULL AND r.graded_at IS NOT NULL",rusqlite::params![id.to_string(),qid,max],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?
        } else {
            conn.query_row("SELECT count(*),coalesce(sum(CASE WHEN abs(r.points-?3)<0.000001 THEN 1 ELSE 0 END),0),coalesce(sum(CASE WHEN r.points>0 AND r.points<?3 THEN 1 ELSE 0 END),0) FROM quiz_attempts a LEFT JOIN quiz_responses r ON r.attempt_id=a.id AND r.question_id=?2 WHERE a.delivery_id=?1 AND a.submitted_at IS NOT NULL",rusqlite::params![id.to_string(),qid,max],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?
        };
        questions.push(QuizQuestionStatistic {
            question_id: parse_uuid(&qid)?,
            prompt,
            graded_count: g as u32,
            correct_percent: if g > 0 {
                100.0 * c as f64 / g as f64
            } else {
                0.0
            },
            partial_percent: if g > 0 {
                100.0 * p as f64 / g as f64
            } else {
                0.0
            },
        })
    }
    let most_correct = questions
        .iter()
        .filter(|q| q.graded_count > 0)
        .max_by(|a, b| a.correct_percent.total_cmp(&b.correct_percent))
        .map(|q| q.question_id.to_string());
    let most_incorrect = questions
        .iter()
        .filter(|q| q.graded_count > 0)
        .min_by(|a, b| a.correct_percent.total_cmp(&b.correct_percent))
        .map(|q| q.question_id.to_string());
    Ok(QuizStatistics {
        assigned_count: assigned as u32,
        started_count: started as u32,
        submitted_count: submitted as u32,
        graded_count: scores.len() as u32,
        highest: scores.last().copied(),
        lowest: scores.first().copied(),
        mean: if scores.is_empty() {
            None
        } else {
            Some(scores.iter().sum::<f64>() / scores.len() as f64)
        },
        median: percentile(0.5),
        lower_quartile: percentile(0.25),
        upper_quartile: percentile(0.75),
        distribution,
        questions,
        most_correct_question_id: most_correct,
        most_incorrect_question_id: most_incorrect,
    })
}
fn parse_uuid(value: &str) -> HostResult<Uuid> {
    value
        .parse()
        .map_err(|e| HostError::Other(anyhow::anyhow!("invalid id: {e}")))
}
fn parse_time(value: &str) -> HostResult<DateTime<Utc>> {
    value
        .parse()
        .map_err(|e| HostError::Other(anyhow::anyhow!("invalid timestamp: {e}")))
}
fn parse_optional_time(value: Option<String>) -> HostResult<Option<DateTime<Utc>>> {
    value.map(|v| parse_time(&v)).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn objective_grading_is_exact_and_short_answer_is_manual() {
        assert_eq!(
            objective_points(
                QuizQuestionKind::TrueFalse,
                &serde_json::json!(true),
                &serde_json::json!(true),
                2.0
            ),
            (Some(2.0), true)
        );
        assert_eq!(
            objective_points(
                QuizQuestionKind::SingleChoice,
                &serde_json::json!("A"),
                &serde_json::json!("B"),
                3.0
            ),
            (Some(0.0), true)
        );
        assert_eq!(
            objective_points(
                QuizQuestionKind::ShortAnswer,
                &serde_json::Value::Null,
                &serde_json::json!("text"),
                4.0
            ),
            (None, false)
        );
    }

    #[test]
    fn live_quiz_requires_join_and_closes_with_session() {
        let pool = crate::db::open_in_memory().unwrap();
        let conn = pool.get().unwrap();
        let teacher = Uuid::new_v4();
        let student = Uuid::new_v4();
        let classroom = Uuid::new_v4();
        let quiz = Uuid::new_v4();
        let version = Uuid::new_v4();
        let session = Uuid::new_v4();
        let delivery = Uuid::new_v4();
        let now = Utc::now();
        for (id, username, role) in [
            (teacher, "teacher", "teacher"),
            (student, "student", "student"),
        ] {
            conn.execute("INSERT INTO users(id,username,display_name,pw_hash,role,created_at) VALUES(?1,?2,?2,'hash',?3,?4)",rusqlite::params![id.to_string(),username,role,now.to_rfc3339()]).unwrap();
        }
        conn.execute("INSERT INTO classrooms(id,name,description,color,created_at,owner_teacher_id,enrolment_code) VALUES(?1,'Class','','#fff',?2,?3,'QUIZ1234')",rusqlite::params![classroom.to_string(),now.to_rfc3339(),teacher.to_string()]).unwrap();
        conn.execute("INSERT INTO quizzes(id,classroom_id,title,instructions,created_by,created_at,updated_at) VALUES(?1,?2,'Quiz','',?3,?4,?4)",rusqlite::params![quiz.to_string(),classroom.to_string(),teacher.to_string(),now.to_rfc3339()]).unwrap();
        conn.execute("INSERT INTO quiz_versions(id,quiz_id,version_number,title,instructions,total_points,published_at) VALUES(?1,?2,1,'Quiz','',1,?3)",rusqlite::params![version.to_string(),quiz.to_string(),now.to_rfc3339()]).unwrap();
        let ends_at = now + Duration::minutes(10);
        conn.execute("INSERT INTO live_module_sessions(id,classroom_id,started_by,module_id,module_name,duration_minutes,join_code,starts_at,ends_at) VALUES(?1,?2,?3,'classroom.live','Live Classroom',10,'LIVEQUIZ01',?4,?5)",rusqlite::params![session.to_string(),classroom.to_string(),teacher.to_string(),now.to_rfc3339(),ends_at.to_rfc3339()]).unwrap();
        conn.execute("INSERT INTO quiz_deliveries(id,version_id,classroom_id,kind,live_session_id,created_by,created_at,assigned_count) VALUES(?1,?2,?3,'live',?4,?5,?6,1)",rusqlite::params![delivery.to_string(),version.to_string(),classroom.to_string(),session.to_string(),teacher.to_string(),now.to_rfc3339()]).unwrap();

        assert!(matches!(
            active_live_deadline(&conn, delivery, student, now),
            Err(HostError::Forbidden)
        ));
        conn.execute("INSERT INTO live_module_participants(session_id,student_id,joined_at,last_seen_at) VALUES(?1,?2,?3,?3)",rusqlite::params![session.to_string(),student.to_string(),now.to_rfc3339()]).unwrap();
        assert_eq!(
            active_live_deadline(&conn, delivery, student, now).unwrap(),
            Some(ends_at)
        );
        conn.execute(
            "UPDATE live_module_sessions SET ended_at=?2 WHERE id=?1",
            rusqlite::params![session.to_string(), now.to_rfc3339()],
        )
        .unwrap();
        assert!(matches!(
            active_live_deadline(&conn, delivery, student, now),
            Err(HostError::Conflict)
        ));
    }
}
