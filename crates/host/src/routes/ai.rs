//! AI configuration and chat.
//!
//! The endpoint is anything OpenAI-compatible, so the same code path serves a
//! hosted provider today and the offline llama.cpp server on the teacher's
//! machine later.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use lumina_ai::ChatClient;
use lumina_core::{AiSettings, ChatRequest, ChatResponse, ChatRole, SaveAiSettings};
use rand::{rngs::OsRng, RngCore};
use rusqlite::OptionalExtension;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/ai/settings", get(read_settings).put(write_settings))
        .route("/api/ai/chat", post(chat))
}

const KEY_BASE_URL: &str = "ai.base_url";
const KEY_MODEL: &str = "ai.model";
const KEY_API_KEY: &str = "ai.api_key";

/// Cap on note text sent as context, so a long note cannot blow the model's
/// window or run up a bill in one click.
const MAX_CONTEXT_CHARS: usize = 6000;

fn get_setting(conn: &rusqlite::Connection, key: &str) -> HostResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get::<_, String>(0)
        })
        .optional()?
        .filter(|v| !v.is_empty()))
}

fn put_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> HostResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

fn encrypt_api_key(secret: &[u8; 32], plaintext: &str) -> HostResult<String> {
    let cipher = Aes256Gcm::new_from_slice(secret).map_err(|error| {
        HostError::Other(anyhow::anyhow!(
            "initialising credential encryption: {error}"
        ))
    })?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|error| HostError::Other(anyhow::anyhow!("encrypting AI credential: {error}")))?;
    Ok(format!(
        "v1:{}:{}",
        hex::encode(nonce),
        hex::encode(encrypted)
    ))
}

fn decrypt_api_key(secret: &[u8; 32], stored: Option<String>) -> HostResult<Option<String>> {
    let Some(stored) = stored.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let mut parts = stored.split(':');
    if parts.next() != Some("v1") {
        return Err(HostError::Other(anyhow::anyhow!(
            "refusing to load an unencrypted AI credential"
        )));
    }
    let nonce = hex::decode(parts.next().unwrap_or_default()).map_err(|error| {
        HostError::Other(anyhow::anyhow!("invalid AI credential nonce: {error}"))
    })?;
    let ciphertext = hex::decode(parts.next().unwrap_or_default()).map_err(|error| {
        HostError::Other(anyhow::anyhow!("invalid encrypted AI credential: {error}"))
    })?;
    if nonce.len() != 12 {
        return Err(HostError::Other(anyhow::anyhow!(
            "invalid AI credential nonce length"
        )));
    }
    let cipher = Aes256Gcm::new_from_slice(secret).map_err(|error| {
        HostError::Other(anyhow::anyhow!(
            "initialising credential encryption: {error}"
        ))
    })?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| {
            HostError::Other(anyhow::anyhow!(
                "the AI credential could not be decrypted on this machine"
            ))
        })?;
    String::from_utf8(plaintext).map(Some).map_err(|error| {
        HostError::Other(anyhow::anyhow!(
            "the AI credential is not valid text: {error}"
        ))
    })
}

async fn read_settings(
    State(state): State<AppState>,
    user: CurrentUser,
) -> HostResult<Json<AiSettings>> {
    user.require_teacher()?;
    let secret = state.ai_key_secret;
    let stored = state
        .db(move |conn| {
            Ok((
                get_setting(conn, KEY_BASE_URL)?,
                get_setting(conn, KEY_MODEL)?,
                decrypt_api_key(&secret, get_setting(conn, KEY_API_KEY)?)?,
            ))
        })
        .await?;

    let (base_url, model, api_key) = stored;
    let reachable = match &base_url {
        Some(url) => {
            ChatClient::new(url, api_key.clone(), model.as_deref().unwrap_or_default())
                .reachable()
                .await
        }
        None => false,
    };

    Ok(Json(AiSettings {
        base_url,
        model: model.unwrap_or_default(),
        has_key: api_key.is_some(),
        reachable,
    }))
}

async fn write_settings(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(req): Json<SaveAiSettings>,
) -> HostResult<Json<AiSettings>> {
    // Only the teacher configures this. On a shared lab the key is the school's,
    // not a student's, and students never need to see or change it.
    user.require_teacher()?;

    if let Some(url) = req.base_url.as_deref() {
        if !url.is_empty() && !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(HostError::BadRequest(
                "The address must start with http:// or https://".into(),
            ));
        }
    }

    let secret = state.ai_key_secret;
    state
        .db(move |conn| {
            put_setting(conn, KEY_BASE_URL, req.base_url.as_deref().unwrap_or(""))?;
            put_setting(conn, KEY_MODEL, &req.model)?;
            // Absent means "leave the stored key alone", so the settings form
            // can be saved without the key being round-tripped through a client.
            if let Some(key) = req.api_key.as_deref() {
                let encrypted = if key.is_empty() {
                    String::new()
                } else {
                    encrypt_api_key(&secret, key)?
                };
                put_setting(conn, KEY_API_KEY, &encrypted)?;
            }
            Ok(())
        })
        .await?;

    read_settings(State(state), user).await
}

async fn chat(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(req): Json<ChatRequest>,
) -> HostResult<Json<ChatResponse>> {
    user.require_teacher()?;
    if req.messages.is_empty() {
        return Err(HostError::BadRequest("Ask a question first.".into()));
    }

    let secret = state.ai_key_secret;
    let config = state
        .db(move |conn| {
            Ok((
                get_setting(conn, KEY_BASE_URL)?,
                get_setting(conn, KEY_MODEL)?,
                decrypt_api_key(&secret, get_setting(conn, KEY_API_KEY)?)?,
            ))
        })
        .await?;

    let (base_url, model, api_key) = config;
    let base_url = base_url.ok_or(HostError::AiUnavailable)?;

    let mut messages: Vec<(String, String)> = vec![(
        "system".into(),
        "You are Lumina's teacher assistant. Help the teacher understand submitted \
         student work, prepare questions, and draft constructive feedback. Never claim \
         that an AI suggestion is a final grade, and never invent evidence that is not \
         present in the selected classroom context."
            .into(),
    )];

    if let Some(context) = req.context.as_deref() {
        let trimmed = context.trim();
        if !trimmed.is_empty() {
            let clipped: String = trimmed.chars().take(MAX_CONTEXT_CHARS).collect();
            messages.push((
                "system".into(),
                format!("The student's notes:\n\n{clipped}"),
            ));
        }
    }

    for message in &req.messages {
        let role = match message.role {
            ChatRole::System => "system",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
        };
        messages.push((role.into(), message.content.clone()));
    }

    let client = ChatClient::new(&base_url, api_key, model.as_deref().unwrap_or_default());
    let content = client
        .complete(&messages)
        .await
        // The upstream message is the useful part ("model not found", "no
        // credit"), so pass it through rather than flattening to "AI failed".
        .map_err(|e| HostError::BadRequest(format!("{e:#}")))?;

    Ok(Json(ChatResponse { content }))
}
