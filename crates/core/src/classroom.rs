//! Classroom, assignment, submission, grading, and attendance contracts.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::{Role, User};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Classroom {
    #[ts(type = "string")]
    pub id: Uuid,
    pub name: String,
    pub subject_code: Option<String>,
    pub description: String,
    pub color: String,
    pub student_count: i64,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateClassroomRequest {
    pub name: String,
    pub subject_code: Option<String>,
    pub description: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateClassroomRequest {
    pub name: String,
    pub subject_code: Option<String>,
    pub description: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnrolStudentRequest {
    #[ts(type = "string")]
    pub student_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClassroomRoster {
    pub classroom: Classroom,
    pub students: Vec<User>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AssignmentStatus {
    Draft,
    Published,
    Closed,
}

impl AssignmentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Published => "published",
            Self::Closed => "closed",
        }
    }
}

impl std::str::FromStr for AssignmentStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "draft" => Ok(Self::Draft),
            "published" => Ok(Self::Published),
            "closed" => Ok(Self::Closed),
            other => Err(format!("unknown assignment status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Assignment {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub classroom_id: Uuid,
    pub classroom_name: String,
    pub title: String,
    pub instructions: String,
    #[ts(type = "string | null")]
    pub due_at: Option<DateTime<Utc>>,
    pub max_points: f64,
    /// Configurable grading definition. Kept as JSON so a school can use points,
    /// percentages, letters, or a rubric without another schema migration.
    #[ts(type = "unknown")]
    pub grading_scheme: serde_json::Value,
    pub status: AssignmentStatus,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateAssignmentRequest {
    #[ts(type = "string")]
    pub classroom_id: Uuid,
    pub title: String,
    pub instructions: String,
    #[ts(type = "string | null")]
    pub due_at: Option<DateTime<Utc>>,
    pub max_points: f64,
    #[ts(type = "unknown")]
    pub grading_scheme: serde_json::Value,
    pub publish: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateAssignmentRequest {
    #[ts(type = "string")]
    pub classroom_id: Uuid,
    pub title: String,
    pub instructions: String,
    #[ts(type = "string | null")]
    pub due_at: Option<DateTime<Utc>>,
    pub max_points: f64,
    #[ts(type = "unknown")]
    pub grading_scheme: serde_json::Value,
    pub status: AssignmentStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SubmissionStatus {
    Draft,
    Submitted,
    Resubmitted,
    Graded,
    Withdrawn,
}

impl SubmissionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Submitted => "submitted",
            Self::Resubmitted => "resubmitted",
            Self::Graded => "graded",
            Self::Withdrawn => "withdrawn",
        }
    }
}

impl std::str::FromStr for SubmissionStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "draft" => Ok(Self::Draft),
            "submitted" => Ok(Self::Submitted),
            "resubmitted" => Ok(Self::Resubmitted),
            "graded" => Ok(Self::Graded),
            "withdrawn" => Ok(Self::Withdrawn),
            other => Err(format!("unknown submission status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SubmitWorkRequest {
    #[ts(type = "unknown")]
    pub doc_json: serde_json::Value,
    pub plaintext: String,
    pub change_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SubmissionVersion {
    #[ts(type = "string")]
    pub id: Uuid,
    pub version_number: i64,
    #[ts(type = "unknown")]
    pub doc_json: serde_json::Value,
    pub plaintext: String,
    pub change_note: Option<String>,
    pub late: bool,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Grade {
    #[ts(type = "string")]
    pub id: Uuid,
    pub points: Option<f64>,
    pub grade_label: Option<String>,
    pub feedback: String,
    pub published: bool,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Submission {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub assignment_id: Uuid,
    pub assignment_title: String,
    #[ts(type = "string")]
    pub student_id: Uuid,
    pub student_name: String,
    pub status: SubmissionStatus,
    pub version: Option<SubmissionVersion>,
    pub grade: Option<Grade>,
    #[ts(type = "string | null")]
    pub submitted_at: Option<DateTime<Utc>>,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveGradeRequest {
    pub points: Option<f64>,
    pub grade_label: Option<String>,
    pub feedback: String,
    pub publish: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GradeChange {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "unknown")]
    pub previous: serde_json::Value,
    #[ts(type = "unknown")]
    pub current: serde_json::Value,
    #[ts(type = "string")]
    pub changed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SubmissionComment {
    #[ts(type = "string")]
    pub id: Uuid,
    pub author_name: String,
    pub body: String,
    #[ts(type = "unknown")]
    pub anchor: Option<serde_json::Value>,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AddCommentRequest {
    pub body: String,
    #[ts(type = "unknown")]
    pub anchor: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AttendanceStatus {
    Present,
    Absent,
    Late,
    Excused,
}

impl AttendanceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Present => "present",
            Self::Absent => "absent",
            Self::Late => "late",
            Self::Excused => "excused",
        }
    }
}

impl std::str::FromStr for AttendanceStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "present" => Ok(Self::Present),
            "absent" => Ok(Self::Absent),
            "late" => Ok(Self::Late),
            "excused" => Ok(Self::Excused),
            other => Err(format!("unknown attendance status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AttendanceRecord {
    #[ts(type = "string")]
    pub student_id: Uuid,
    pub student_name: String,
    pub status: Option<AttendanceStatus>,
    pub note: String,
    /// A recent login is a suggestion only; the teacher remains authoritative.
    pub checked_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AttendanceDay {
    #[ts(type = "string")]
    pub day: NaiveDate,
    pub records: Vec<AttendanceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveAttendanceRequest {
    #[ts(type = "string")]
    pub student_id: Uuid,
    pub status: AttendanceStatus,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BootstrapTeacherRequest {
    pub username: String,
    pub display_name: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BootstrapTeacherResponse {
    pub user: User,
    /// Shown exactly once. Only its Argon2id hash is stored.
    pub recovery_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateStudentRequest {
    pub username: String,
    pub display_name: String,
    pub grade_level: Option<String>,
    pub section: Option<String>,
    pub roll_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RegisterTeacherRequest {
    pub username: String,
    pub display_name: String,
    pub password: String,
    /// A current teacher recovery code acts as the school's authorization code.
    pub school_recovery_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateStudentRequest {
    pub username: String,
    pub display_name: String,
    pub grade_level: Option<String>,
    pub section: Option<String>,
    pub roll_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateStudentResponse {
    pub user: User,
    /// Four-digit, one-time PIN shown once to the teacher.
    pub temporary_password: String,
    /// A separate rotating recovery code. Only its Argon2id hash is stored.
    pub recovery_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RecoverTeacherRequest {
    pub username: String,
    pub recovery_code: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DashboardStats {
    pub students: i64,
    pub classrooms: i64,
    pub pending_submissions: i64,
    pub ungraded_submissions: i64,
    pub present_today: i64,
}

/// The role requested by a particular app binary. The server still checks the
/// stored account role on every protected route.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppLoginRequest {
    pub username: String,
    pub password: String,
    pub device_label: Option<String>,
    pub expected_role: Role,
}
