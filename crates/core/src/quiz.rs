//! Versioned classroom quizzes and role-safe attempt contracts.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum QuizQuestionKind {
    SingleChoice,
    TrueFalse,
    ShortAnswer,
}

impl QuizQuestionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SingleChoice => "single_choice",
            Self::TrueFalse => "true_false",
            Self::ShortAnswer => "short_answer",
        }
    }
}

impl std::str::FromStr for QuizQuestionKind {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "single_choice" => Ok(Self::SingleChoice),
            "true_false" => Ok(Self::TrueFalse),
            "short_answer" => Ok(Self::ShortAnswer),
            _ => Err(format!("unknown quiz question kind: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum QuizDeliveryKind {
    Homework,
    Live,
}

impl QuizDeliveryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Homework => "homework",
            Self::Live => "live",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuizQuestionInput {
    #[ts(type = "string | null")]
    pub id: Option<Uuid>,
    pub kind: QuizQuestionKind,
    pub prompt: String,
    pub options: Vec<String>,
    #[ts(type = "unknown")]
    pub canonical_answer: serde_json::Value,
    pub max_points: f64,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuizQuestion {
    #[ts(type = "string")]
    pub id: Uuid,
    pub position: u32,
    pub kind: QuizQuestionKind,
    pub prompt: String,
    pub options: Vec<String>,
    #[ts(type = "unknown")]
    pub canonical_answer: serde_json::Value,
    pub max_points: f64,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StudentQuizQuestion {
    #[ts(type = "string")]
    pub id: Uuid,
    pub position: u32,
    pub kind: QuizQuestionKind,
    pub prompt: String,
    pub options: Vec<String>,
    pub max_points: f64,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Quiz {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub classroom_id: Uuid,
    pub classroom_name: String,
    pub title: String,
    pub instructions: String,
    pub time_limit_minutes: Option<u32>,
    pub archived: bool,
    pub published_version: Option<u32>,
    pub questions: Vec<QuizQuestion>,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveQuizRequest {
    #[ts(type = "string")]
    pub classroom_id: Uuid,
    pub title: String,
    pub instructions: String,
    pub time_limit_minutes: Option<u32>,
    pub questions: Vec<QuizQuestionInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeliverQuizRequest {
    pub kind: QuizDeliveryKind,
    #[ts(type = "string | null")]
    pub live_session_id: Option<Uuid>,
    #[ts(type = "string | null")]
    pub opens_at: Option<DateTime<Utc>>,
    #[ts(type = "string | null")]
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuizDelivery {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub quiz_id: Uuid,
    #[ts(type = "string")]
    pub version_id: Uuid,
    #[ts(type = "string")]
    pub classroom_id: Uuid,
    pub classroom_name: String,
    pub title: String,
    pub instructions: String,
    pub kind: QuizDeliveryKind,
    pub time_limit_minutes: Option<u32>,
    pub total_points: f64,
    #[ts(type = "string | null")]
    pub opens_at: Option<DateTime<Utc>>,
    #[ts(type = "string | null")]
    pub due_at: Option<DateTime<Utc>>,
    #[ts(type = "string | null")]
    pub results_released_at: Option<DateTime<Utc>>,
    pub attempt_id: Option<String>,
    pub attempt_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuizResponse {
    #[ts(type = "string")]
    pub question_id: Uuid,
    #[ts(type = "unknown")]
    pub answer: serde_json::Value,
    pub points: Option<f64>,
    pub feedback: String,
    pub correct: Option<bool>,
    #[ts(type = "unknown | null")]
    pub canonical_answer: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuizAttempt {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub student_id: Uuid,
    pub student_name: String,
    pub delivery: QuizDelivery,
    pub questions: Vec<StudentQuizQuestion>,
    pub responses: Vec<QuizResponse>,
    #[ts(type = "string")]
    pub started_at: DateTime<Utc>,
    #[ts(type = "string | null")]
    pub expires_at: Option<DateTime<Utc>>,
    #[ts(type = "string | null")]
    pub submitted_at: Option<DateTime<Utc>>,
    pub score: Option<f64>,
    pub max_points: f64,
    pub manual_grading_complete: bool,
    pub released: bool,
    #[ts(type = "string")]
    pub server_now: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveQuizResponseRequest {
    #[ts(type = "unknown")]
    pub answer: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GradeQuizResponseRequest {
    pub points: f64,
    pub feedback: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuizQuestionStatistic {
    #[ts(type = "string")]
    pub question_id: Uuid,
    pub prompt: String,
    pub graded_count: u32,
    pub correct_percent: f64,
    pub partial_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuizStatistics {
    pub assigned_count: u32,
    pub started_count: u32,
    pub submitted_count: u32,
    pub graded_count: u32,
    pub highest: Option<f64>,
    pub lowest: Option<f64>,
    pub mean: Option<f64>,
    pub median: Option<f64>,
    pub lower_quartile: Option<f64>,
    pub upper_quartile: Option<f64>,
    pub distribution: Vec<u32>,
    pub questions: Vec<QuizQuestionStatistic>,
    pub most_correct_question_id: Option<String>,
    pub most_incorrect_question_id: Option<String>,
}
