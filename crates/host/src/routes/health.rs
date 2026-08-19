//! Unauthenticated liveness endpoint. Clients poll this to decide whether the
//! host is reachable and whether to show the AI actions at all.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use cinder_core::HealthResponse;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/health", get(health))
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        version: env!("CARGO_PKG_VERSION").to_owned(),
        ai_available: state.ai.available().await,
    })
}
