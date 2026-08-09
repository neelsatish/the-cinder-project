//! Client for the local `llama-server`.
//!
//! The model runs as a separate llama.cpp process on the teacher's machine,
//! bound to localhost, and we talk to it over HTTP. Keeping it out-of-process is
//! deliberate: a wedged or OOM-killed model must never take the study app down
//! with it, and the school can swap the model file without a rebuild.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use cinder_core::GeneratedCard;
use serde::Deserialize;

pub mod grammar;

/// Handle to the local model. `Ai::disabled()` is a fully working no-op, so a
/// student machine and a host without a model behave identically: the UI simply
/// hides every AI action.
pub struct Ai {
    base_url: Option<String>,
    client: reqwest::Client,
}

impl Ai {
    pub fn disabled() -> Self {
        Self {
            base_url: None,
            client: reqwest::Client::new(),
        }
    }

    pub fn at(base_url: impl Into<String>) -> Self {
        Self {
            base_url: Some(base_url.into().trim_end_matches('/').to_owned()),
            // Generation on a recovered i5 is slow. This timeout is sized for
            // "a paragraph into eight flashcards", not for a chat reply.
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(180))
                .build()
                .expect("building an http client cannot fail"),
        }
    }

    pub fn is_configured(&self) -> bool {
        self.base_url.is_some()
    }

    /// Whether the model is actually answering right now — not just configured.
    /// Used by `/api/health` so the client can hide AI buttons instead of
    /// offering one that will fail.
    pub async fn available(&self) -> bool {
        let Some(base) = &self.base_url else {
            return false;
        };
        match self
            .client
            .get(format!("{base}/health"))
            .timeout(Duration::from_secs(2))
            .send()
            .await
        {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    /// Turns a passage the student selected into flashcards.
    ///
    /// The response is constrained by a GBNF grammar, so the model physically
    /// cannot emit anything but the expected JSON shape. A 3B model asked
    /// politely for JSON will still produce prose roughly one time in ten, and
    /// in a classroom that failure is not recoverable by retrying.
    pub async fn generate_cards(&self, excerpt: &str, count: u8) -> Result<Vec<GeneratedCard>> {
        let Some(base) = &self.base_url else {
            bail!("the local AI is not configured on this machine");
        };

        let excerpt = truncate_on_char_boundary(excerpt, MAX_EXCERPT_CHARS);
        let count = count.clamp(1, 20);

        let prompt = format!(
            "You write flashcards for school students.\n\
             Read the passage and write exactly {count} question-and-answer flashcards \
             covering its most important facts.\n\
             Use only information stated in the passage. Keep each answer under 20 words.\n\n\
             Passage:\n{excerpt}\n"
        );

        let response = self
            .client
            .post(format!("{base}/completion"))
            .json(&serde_json::json!({
                "prompt": prompt,
                "grammar": grammar::CARDS_GBNF,
                "temperature": 0.3,
                "n_predict": 1024,
                "cache_prompt": true,
            }))
            .send()
            .await
            .context("asking the local model for flashcards")?;

        if !response.status().is_success() {
            bail!("the local model returned {}", response.status());
        }

        #[derive(Deserialize)]
        struct Completion {
            content: String,
        }

        let completion: Completion = response
            .json()
            .await
            .context("reading the model's response")?;

        #[derive(Deserialize)]
        struct CardsPayload {
            cards: Vec<GeneratedCard>,
        }

        let payload: CardsPayload =
            serde_json::from_str(&completion.content).with_context(|| {
                format!(
                    "the model's output did not match the grammar: {}",
                    completion.content.chars().take(200).collect::<String>()
                )
            })?;

        Ok(payload
            .cards
            .into_iter()
            .filter(|card| !card.front.trim().is_empty() && !card.back.trim().is_empty())
            .collect())
    }
}

/// Roughly 2k tokens of context, leaving room for the instructions and the
/// answer inside a small model's window.
const MAX_EXCERPT_CHARS: usize = 6000;

/// A chat client for any OpenAI-compatible `/chat/completions` endpoint.
///
/// One shape covers llama.cpp's server, Ollama, OpenRouter and the hosted
/// providers — which is the point. The school starts on whatever it can reach
/// today and moves to the offline model later without this code changing.
pub struct ChatClient {
    base_url: String,
    api_key: Option<String>,
    model: String,
    client: reqwest::Client,
}

impl ChatClient {
    pub fn new(base_url: &str, api_key: Option<String>, model: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key,
            model: model.to_owned(),
            client: reqwest::Client::builder()
                // Long, because the eventual local model on a recovered i5 is slow.
                .timeout(Duration::from_secs(180))
                .build()
                .expect("building an http client cannot fail"),
        }
    }

    /// Cheap liveness probe: list models. Every compatible server implements it.
    pub async fn reachable(&self) -> bool {
        let mut request = self
            .client
            .get(format!("{}/models", self.base_url))
            .timeout(Duration::from_secs(4));
        if let Some(key) = &self.api_key {
            request = request.bearer_auth(key);
        }
        matches!(request.send().await, Ok(r) if r.status().is_success())
    }

    pub async fn complete(&self, messages: &[(String, String)]) -> Result<String> {
        let payload = serde_json::json!({
            "model": self.model,
            "messages": messages
                .iter()
                .map(|(role, content)| serde_json::json!({ "role": role, "content": content }))
                .collect::<Vec<_>>(),
            "temperature": 0.4,
            "stream": false,
        });

        let mut request = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .json(&payload);
        if let Some(key) = &self.api_key {
            request = request.bearer_auth(key);
        }

        let response = request.send().await.context("asking the model")?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            // Surface the provider's own message — "insufficient quota" is far
            // more useful to a teacher than "the AI returned 429".
            bail!(
                "{}",
                upstream_error(&body).unwrap_or_else(|| format!("the AI returned {status}"))
            );
        }

        #[derive(Deserialize)]
        struct Choice {
            message: Message,
        }
        #[derive(Deserialize)]
        struct Message {
            content: Option<String>,
        }
        #[derive(Deserialize)]
        struct Completion {
            choices: Vec<Choice>,
        }

        let parsed: Completion =
            serde_json::from_str(&body).context("the AI sent a reply we could not read")?;
        let content = parsed
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .unwrap_or_default();

        if content.trim().is_empty() {
            bail!("the AI sent an empty reply");
        }
        Ok(content)
    }
}

/// Pulls `error.message` out of an OpenAI-style error body.
fn upstream_error(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .get("error")?
        .get("message")?
        .as_str()
        .map(str::to_owned)
}

/// `&str[..n]` panics if `n` lands inside a multi-byte character, which Kannada
/// and Devanagari text hits immediately.
fn truncate_on_char_boundary(text: &str, max_chars: usize) -> &str {
    match text.char_indices().nth(max_chars) {
        Some((byte_index, _)) => &text[..byte_index],
        None => text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_ai_is_never_available() {
        let ai = Ai::disabled();
        assert!(!ai.is_configured());
    }

    #[test]
    fn truncation_respects_multibyte_characters() {
        let kannada = "ಬೆಳಕು ಗಾಜಿನೊಳಗೆ ಬಾಗುತ್ತದೆ";
        let cut = truncate_on_char_boundary(kannada, 5);
        assert_eq!(cut.chars().count(), 5);

        let short = truncate_on_char_boundary("abc", 100);
        assert_eq!(short, "abc");
    }
}
