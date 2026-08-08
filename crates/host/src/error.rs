//! One error type for every route, mapped to an HTTP status and a JSON body.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use lumina_core::ApiError;

pub type HostResult<T> = Result<T, HostError>;

#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("invalid username or password")]
    BadCredentials,

    #[error("not signed in")]
    Unauthenticated,

    #[error("you do not have access to that")]
    Forbidden,

    #[error("{0} not found")]
    NotFound(&'static str),

    #[error("{0}")]
    BadRequest(String),

    /// The row moved on since the client last read it. The client should reload
    /// and let the student decide, never silently overwrite.
    #[error("this was changed somewhere else since you last opened it")]
    Conflict,

    #[error("the AI service is not configured or reachable")]
    AiUnavailable,

    #[error(transparent)]
    Database(#[from] rusqlite::Error),

    #[error(transparent)]
    Pool(#[from] r2d2::Error),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl HostError {
    fn parts(&self) -> (StatusCode, &'static str) {
        match self {
            // Deliberately identical to Unauthenticated from the client's point of
            // view, so a wrong username and a wrong password are indistinguishable.
            HostError::BadCredentials => (StatusCode::UNAUTHORIZED, "bad_credentials"),
            HostError::Unauthenticated => (StatusCode::UNAUTHORIZED, "unauthenticated"),
            HostError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            HostError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            HostError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            HostError::Conflict => (StatusCode::CONFLICT, "conflict"),
            HostError::AiUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "ai_unavailable"),
            HostError::Database(_) | HostError::Pool(_) | HostError::Other(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        }
    }
}

impl IntoResponse for HostError {
    fn into_response(self) -> Response {
        let (status, code) = self.parts();

        // Internal errors get logged in full and reported vaguely: a student
        // machine should never display a SQL string.
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self, "request failed");
            "Something went wrong on the teacher's computer.".to_owned()
        } else {
            self.to_string()
        };

        let body = ApiError {
            error: code.to_owned(),
            message,
        };

        (status, Json(body)).into_response()
    }
}
