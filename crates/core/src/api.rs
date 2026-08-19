//! Request/response types for the host HTTP API.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::model::{Node, NodeKind, Role, SessionKind, User};

// ---------------------------------------------------------------- auth

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    /// Free text shown to the teacher in the sessions list, e.g. "Lab PC 4".
    pub device_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LoginResponse {
    pub token: String,
    pub user: User,
    #[ts(type = "string")]
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateUserRequest {
    pub username: String,
    pub display_name: String,
    pub password: String,
    pub role: Role,
}

// ---------------------------------------------------------------- tree

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TreeResponse {
    /// Flat list. The client builds the tree from `parent_id`; sending it flat
    /// keeps the payload small and lets the UI virtualize long subject lists.
    pub nodes: Vec<Node>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateNodeRequest {
    #[ts(type = "string | null")]
    pub parent_id: Option<Uuid>,
    #[ts(type = "string | null")]
    pub classroom_id: Option<Uuid>,
    pub name: String,
    pub kind: NodeKind,
    pub icon: Option<String>,
}

/// Every field optional: this is a partial update used for rename, move and reorder.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateNodeRequest {
    /// Every field is `#[ts(optional)]` so the generated TypeScript emits `name?:`
    /// rather than `name:`. That is not cosmetic — with required keys a caller
    /// doing a rename would be forced to pass `parent_id: null`, which means
    /// "move to the root", silently relocating the node it meant to rename.
    #[ts(optional)]
    pub name: Option<String>,
    /// `Some(None)` moves the node to the root; `None` leaves the parent alone.
    ///
    /// The custom deserializer is load-bearing. Plain serde maps both an absent
    /// field and an explicit `null` to `None`, which would make "move to the
    /// root" unexpressible — the request would be accepted and silently ignored.
    #[ts(optional, type = "string | null")]
    #[serde(default)]
    #[serde(deserialize_with = "explicit_null_is_some_none")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Option<Uuid>>,
    #[ts(optional)]
    pub position: Option<i64>,
    #[ts(optional)]
    pub icon: Option<String>,
}

/// Distinguishes an absent field from an explicit `null`.
///
/// Only called when the key is present, so wrapping in `Some` is what separates
/// `{"parent_id": null}` (move to root) from `{}` (leave the parent alone).
fn explicit_null_is_some_none<'de, D>(deserializer: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Uuid>::deserialize(deserializer).map(Some)
}

// ---------------------------------------------------------------- notes

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NoteBody {
    /// TipTap/ProseMirror document JSON — the source of truth for rendering.
    #[ts(type = "unknown")]
    pub doc_json: serde_json::Value,
    /// Flattened text, kept in sync on every save. Powers FTS5 search and is
    /// what gets sent to the local model — never send `doc_json` to the AI.
    pub plaintext: String,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveNoteRequest {
    #[ts(type = "unknown")]
    pub doc_json: serde_json::Value,
    pub plaintext: String,
    /// The `updated_at` the client last saw. The host rejects the write with
    /// `409` if the row moved on, so a stale offline outbox cannot clobber a
    /// newer edit without the student being told.
    #[ts(type = "string | null")]
    pub base_updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SearchHit {
    #[ts(type = "string")]
    pub node_id: Uuid,
    pub name: String,
    /// FTS5 snippet of the student's own prose, with matches wrapped in
    /// [`MATCH_START`]/[`MATCH_END`] control characters.
    ///
    /// Deliberately not HTML: the client renders this as text and builds its own
    /// highlight elements, so a note containing markup cannot execute anywhere.
    pub snippet: String,
}

/// Precedes a matched run inside [`SearchHit::snippet`] (ASCII STX).
pub const MATCH_START: char = '\u{2}';
/// Ends a matched run inside [`SearchHit::snippet`] (ASCII ETX).
pub const MATCH_END: char = '\u{3}';

// ---------------------------------------------------------------- study log

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LogSessionRequest {
    #[ts(type = "string | null")]
    pub node_id: Option<Uuid>,
    #[ts(type = "string")]
    pub started_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub ended_at: DateTime<Utc>,
    pub planned_seconds: i64,
    pub actual_seconds: i64,
    pub kind: SessionKind,
    pub interrupted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StudySummary {
    pub total_seconds: i64,
    pub sessions_started: i64,
    pub sessions_completed: i64,
    pub current_streak_days: i64,
    pub by_subject: Vec<SubjectTotal>,
    pub by_day: Vec<DayTotal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SubjectTotal {
    #[ts(type = "string | null")]
    pub subject_id: Option<Uuid>,
    pub subject_name: String,
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DayTotal {
    /// `YYYY-MM-DD` in the host's local timezone — the school day, not UTC.
    pub day: String,
    pub seconds: i64,
}

// ---------------------------------------------------------------- files

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileMeta {
    #[ts(type = "string")]
    pub node_id: Uuid,
    pub orig_name: String,
    pub bytes: i64,
    pub mime: String,
}

/// What the material tab is allowed to accept.
///
/// Whitelisted rather than blacklisted, and checked against the sniffed bytes
/// rather than the filename: a lab machine should not become a way to pass
/// executables between students.
pub const ALLOWED_UPLOAD_MIMES: &[&str] = &[
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
];

/// Cap on a single upload. Generous for a scanned chapter, small enough that one
/// student cannot fill the teacher's disk in an afternoon.
pub const MAX_UPLOAD_BYTES: usize = 32 * 1024 * 1024;

// ---------------------------------------------------------------- ai

/// AI configuration as the client is allowed to see it — note there is no key
/// here. The key is written once and never read back out of the host.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiSettings {
    /// An OpenAI-compatible base URL, e.g. `http://127.0.0.1:8080/v1` for
    /// llama.cpp, or a hosted provider while the school still has internet.
    #[ts(optional)]
    pub base_url: Option<String>,
    pub model: String,
    /// Whether a key is stored, so the UI can say "set" without ever showing it.
    pub has_key: bool,
    /// False until the endpoint actually answers.
    pub reachable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveAiSettings {
    #[ts(optional)]
    pub base_url: Option<String>,
    pub model: String,
    /// Absent leaves the stored key alone; empty string clears it.
    #[ts(optional)]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    /// Optional note text the student wants the assistant to work from.
    #[ts(optional)]
    pub context: Option<String>,
    /// Optional response budget for structured, long-form tasks such as papers.
    /// Ordinary chat leaves this unset so provider defaults remain unchanged.
    #[serde(default)]
    #[ts(optional)]
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatResponse {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GenerateCardsRequest {
    #[ts(type = "string")]
    pub source_node_id: Uuid,
    /// The passage the student selected. Capped host-side before it reaches the model.
    pub excerpt: String,
    pub count: u8,
    #[ts(type = "string")]
    pub deck_node_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GeneratedCard {
    pub front: String,
    pub back: String,
}

// ---------------------------------------------------------------- misc

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HealthResponse {
    pub ok: bool,
    pub version: String,
    /// False when `llama-server` is not running, so the UI can hide AI actions
    /// instead of offering a button that fails.
    pub ai_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ApiError {
    pub error: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three states of `parent_id` must stay distinguishable. Collapsing
    /// `null` into "absent" makes moving a node to the root impossible while
    /// still returning 200, which is the worst kind of bug: silent.
    #[test]
    fn update_node_distinguishes_absent_from_explicit_null() {
        let absent: UpdateNodeRequest = serde_json::from_str(r#"{"name":"Physics"}"#).unwrap();
        assert_eq!(
            absent.parent_id, None,
            "absent means leave the parent alone"
        );

        let to_root: UpdateNodeRequest = serde_json::from_str(r#"{"parent_id":null}"#).unwrap();
        assert_eq!(
            to_root.parent_id,
            Some(None),
            "explicit null means move to root"
        );

        let id = Uuid::new_v4();
        let moved: UpdateNodeRequest =
            serde_json::from_str(&format!(r#"{{"parent_id":"{id}"}}"#)).unwrap();
        assert_eq!(moved.parent_id, Some(Some(id)));
    }

    #[test]
    fn update_node_omits_absent_parent_when_serialized() {
        let json = serde_json::to_string(&UpdateNodeRequest::default()).unwrap();
        assert!(
            !json.contains("parent_id"),
            "an absent parent must not be sent as null: {json}"
        );
    }
}
