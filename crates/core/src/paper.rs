//! Generated question papers and the online sources behind them.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// How much of a source paper the teacher intends to reuse. Boards allow
/// classroom use on their own terms, so the stricter two modes carry a recorded
/// confirmation rather than being silently equivalent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PaperSourceMode {
    /// Original questions adapted from the source, with approved figures.
    Adapt,
    /// Exact questions or crops lifted from the source.
    Excerpt,
    /// Whole source pages embedded as images.
    FullPage,
}

impl PaperSourceMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Adapt => "adapt",
            Self::Excerpt => "excerpt",
            Self::FullPage => "full_page",
        }
    }

    /// The two reuse modes need the teacher to confirm the school may reproduce
    /// the material before anything is stored.
    pub fn needs_rights_confirmation(self) -> bool {
        !matches!(self, Self::Adapt)
    }
}

impl std::str::FromStr for PaperSourceMode {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "adapt" => Ok(Self::Adapt),
            "excerpt" => Ok(Self::Excerpt),
            "full_page" => Ok(Self::FullPage),
            _ => Err(format!("unknown paper source mode: {value}")),
        }
    }
}

/// One past paper found online. Nothing is downloaded until the teacher picks
/// one, which is also what keeps Cinder clear of automated crawling.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaperCandidate {
    pub title: String,
    pub url: String,
    pub board: String,
    pub year: String,
    pub session: String,
    pub variant: String,
    pub snippet: String,
}

/// A figure located on a rendered page. `box_2d` is `[ymin, xmin, ymax, xmax]`,
/// each normalised to 0–1000 of the supplied image, so the client can crop
/// without the model knowing the page's pixel size.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaperFigure {
    pub page: u32,
    pub box_2d: [u16; 4],
    pub caption: String,
    pub alt: String,
}

/// One rendered page on its way to figure detection. Discarded once the boxes
/// come back; page images are never stored.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaperPageImage {
    pub page: u32,
    /// Base64 JPEG, without a data-URL prefix.
    pub jpeg_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaperSearchRequest {
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaperFetchRequest {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PaperFiguresRequest {
    pub pages: Vec<PaperPageImage>,
}

/// A stored paper. The marking scheme travels with it because every route that
/// returns this type is teacher-only; student-facing work is produced by
/// publishing an assignment or a quiz, never by serialising this.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuestionPaper {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "string")]
    pub owner_id: Uuid,
    #[ts(type = "string | null")]
    pub classroom_id: Option<Uuid>,
    pub title: String,
    pub subject: String,
    pub board: String,
    pub syllabus_code: String,
    pub difficulty: u8,
    pub source_mode: PaperSourceMode,
    pub rights_confirmed: bool,
    #[ts(type = "unknown")]
    pub spec: serde_json::Value,
    #[ts(type = "unknown")]
    pub scheme: serde_json::Value,
    #[ts(type = "unknown")]
    pub sources: serde_json::Value,
    #[ts(type = "unknown")]
    pub advanced: serde_json::Value,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SaveQuestionPaperRequest {
    #[ts(type = "string | null")]
    pub classroom_id: Option<Uuid>,
    pub title: String,
    pub subject: String,
    pub board: String,
    pub syllabus_code: String,
    pub difficulty: u8,
    pub source_mode: PaperSourceMode,
    pub rights_confirmed: bool,
    #[ts(type = "unknown")]
    pub spec: serde_json::Value,
    #[ts(type = "unknown")]
    pub scheme: serde_json::Value,
    #[ts(type = "unknown")]
    pub sources: serde_json::Value,
    #[ts(type = "unknown")]
    pub advanced: serde_json::Value,
}
