//! Domain model. These types mirror the SQLite schema in `crates/host/migrations`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Role {
    Student,
    Teacher,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Student => "student",
            Role::Teacher => "teacher",
        }
    }

    pub fn is_teacher(self) -> bool {
        matches!(self, Role::Teacher)
    }
}

impl std::str::FromStr for Role {
    type Err = ParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "student" => Ok(Role::Student),
            "teacher" => Ok(Role::Teacher),
            other => Err(ParseError::UnknownRole(other.to_owned())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct User {
    #[ts(type = "string")]
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub grade_level: Option<String>,
    pub section: Option<String>,
    pub roll_number: Option<String>,
    /// Temporary credentials are replaced on the student's first successful login.
    pub must_change_password: bool,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
}

/// Every item a student owns is a node in one tree: subjects and topics are
/// `Folder`s, everything else is a leaf. There is no separate "file explorer" —
/// the subject organizer *is* this tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum NodeKind {
    Folder,
    Note,
    Pdf,
    Deck,
}

impl NodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::Folder => "folder",
            NodeKind::Note => "note",
            NodeKind::Pdf => "pdf",
            NodeKind::Deck => "deck",
        }
    }

    /// Only folders may have children. Enforced in the host before any move.
    pub fn can_have_children(self) -> bool {
        matches!(self, NodeKind::Folder)
    }
}

impl std::str::FromStr for NodeKind {
    type Err = ParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "folder" => Ok(NodeKind::Folder),
            "note" => Ok(NodeKind::Note),
            "pdf" => Ok(NodeKind::Pdf),
            "deck" => Ok(NodeKind::Deck),
            other => Err(ParseError::UnknownNodeKind(other.to_owned())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Node {
    #[ts(type = "string")]
    pub id: Uuid,
    /// `None` means this node belongs to the shared class library that the
    /// teacher curates and every student can read.
    #[ts(type = "string | null")]
    pub owner_id: Option<Uuid>,
    #[ts(type = "string | null")]
    pub parent_id: Option<Uuid>,
    #[ts(type = "string | null")]
    pub classroom_id: Option<Uuid>,
    pub name: String,
    pub kind: NodeKind,
    /// Sort key among siblings. Sparse (steps of 1024) so a drag-drop reorder
    /// usually rewrites one row instead of the whole sibling set.
    pub position: i64,
    pub icon: Option<String>,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

/// Gap between sibling positions, so inserts land between two rows without a rewrite.
pub const POSITION_STEP: i64 = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SessionKind {
    Focus,
    Break,
}

/// One logged stretch of study. This table is the project's impact evidence —
/// every minute is attributed to a subject via `node_id`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StudySession {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub user_id: Uuid,
    #[ts(type = "string | null")]
    pub node_id: Option<Uuid>,
    #[ts(type = "string")]
    pub started_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub ended_at: DateTime<Utc>,
    pub planned_seconds: i64,
    pub actual_seconds: i64,
    pub kind: SessionKind,
    /// True when the student stopped early. Kept because "started 40 sessions,
    /// finished 12" is a more honest signal than raw hours.
    pub interrupted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Card {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub deck_node_id: Uuid,
    pub front: String,
    pub back: String,
    /// Which note or PDF this card came from, so a student can jump back to context.
    #[ts(type = "string | null")]
    pub source_node_id: Option<Uuid>,
    pub source_excerpt: Option<String>,
    pub generated_by: CardOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCardRequest {
    pub front: String,
    pub back: String,
    #[ts(type = "string | null")]
    pub source_node_id: Option<Uuid>,
    pub source_excerpt: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum CardOrigin {
    Manual,
    Ai,
}

impl CardOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Ai => "ai",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("unknown role: {0}")]
    UnknownRole(String),
    #[error("unknown node kind: {0}")]
    UnknownNodeKind(String),
}
