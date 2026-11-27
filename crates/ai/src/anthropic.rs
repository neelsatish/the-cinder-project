//! Anthropic's native Messages API.
//!
//! Used instead of Anthropic's OpenAI-compatibility layer because that layer
//! rejects the `temperature` the shared `ChatClient` always sends, ignores
//! `reasoning_effort` and is documented as not production-ready. Two models are
//! offered: Haiku for everyone, Sonnet for teachers only (the Host decides who
//! may ask for which; nothing here knows about roles).

use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    read_limited_response, upstream_error, TextCompletion, TokenUsage, MAX_PROVIDER_RESPONSE_BYTES,
};

pub const HAIKU: &str = "claude-haiku-5-5";
pub const SONNET: &str = "claude-sonnet-5-5";

const API_ROOT: &str = "https://api.anthropic.com/v1";
/// The version header Anthropic's current reference documents.
const API_VERSION: &str = "2026-10-21";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Speaker {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    /// `image/jpeg`, `image/png`, `image/gif` or `image/webp`.
    pub media_type: String,
    /// Standard base64, no data-URL prefix.
    pub data: String,
}

#[derive(Debug, Clone)]
pub struct Turn {
    pub speaker: Speaker,
    pub text: String,
    pub images: Vec<Image>,
}

pub struct Request<'a> {
    pub model: &'a str,
    pub system: &'a str,
    pub turns: Vec<Turn>,
    /// Adaptive thinking counts against this, so leave room for it.
    pub max_tokens: u32,
    /// Turns thinking off. Only Haiku accepts that; Sonnet 5.5 answers a
    /// `disabled` request with a 400, so the flag is ignored for it.
    pub no_thinking: bool,
}

/// A reply the model stopped early, kept whole so a caller that has already
/// spent the tokens (and must count them) can still use or log what came back.
#[derive(Debug)]
pub struct Stopped {
    pub reason: StopReason,
    /// Whatever text arrived before it stopped; may be empty.
    pub partial: String,
    pub usage: TokenUsage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// Ran out of `max_tokens` mid-answer.
    TooLong,
    /// The model declined to answer.
    Refused,
}

impl std::fmt::Display for Stopped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.reason {
            StopReason::TooLong => {
                f.write_str("The AI ran out of room before it finished. Try a shorter request.")
            }
            StopReason::Refused => f.write_str("The AI declined to answer that."),
        }
    }
}

impl std::error::Error for Stopped {}

pub struct AnthropicClient {
    api_key: String,
    root: String,
    client: reqwest::Client,
}

impl AnthropicClient {
    pub fn new(api_key: &str) -> Self {
        Self::with_root(api_key, API_ROOT)
    }

    /// The address is injectable so tests can talk to a local stand-in.
    pub fn with_root(api_key: &str, root: &str) -> Self {
        Self {
            api_key: api_key.trim().to_owned(),
            root: root.trim_end_matches('/').to_owned(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(170))
                .build()
                .expect("building an http client cannot fail"),
        }
    }

    /// Whether the key is accepted right now. Listing models needs a valid key
    /// and spends nothing.
    pub async fn reachable(&self) -> bool {
        matches!(
            self.client
                .get(format!("{}/models?limit=1", self.root))
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", API_VERSION)
                .timeout(Duration::from_secs(5))
                .send()
                .await,
            Ok(response) if response.status().is_success()
        )
    }

    pub async fn complete(&self, request: &Request<'_>) -> Result<TextCompletion> {
        let body = build_body(request)?;
        let response = self
            .client
            .post(format!("{}/messages", self.root))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .json(&body)
            .send()
            .await
            .context("asking Anthropic")?;
        let status = response.status();
        let raw = String::from_utf8_lossy(
            &read_limited_response(response, MAX_PROVIDER_RESPONSE_BYTES).await?,
        )
        .into_owned();
        if !status.is_success() {
            bail!(
                "{}",
                upstream_error(&raw).unwrap_or_else(|| format!("Anthropic returned {status}"))
            );
        }
        parse_reply(&raw)
    }
}

/// Builds the request body. Pure, so the shape that decides whether Anthropic
/// answers or returns a 400 is covered by tests that need no key.
fn build_body(request: &Request<'_>) -> Result<Value> {
    // The caller may produce two user turns in a row (reference data, then the
    // question); the API wants alternating turns, so neighbours are merged.
    let mut merged: Vec<Turn> = Vec::new();
    for turn in &request.turns {
        if turn.text.trim().is_empty() && turn.images.is_empty() {
            continue;
        }
        match merged.last_mut() {
            Some(last) if last.speaker == turn.speaker => {
                if !turn.text.trim().is_empty() {
                    if !last.text.is_empty() {
                        last.text.push_str("\n\n");
                    }
                    last.text.push_str(&turn.text);
                }
                last.images.extend(turn.images.iter().cloned());
            }
            _ => merged.push(turn.clone()),
        }
    }
    if merged.first().map(|turn| turn.speaker) != Some(Speaker::User) {
        bail!("the conversation must start with a question");
    }
    // Claude 4.6 and later reject a conversation that ends on an assistant turn.
    if merged.last().map(|turn| turn.speaker) != Some(Speaker::User) {
        bail!("the conversation must end with a question");
    }

    let messages: Vec<Value> = merged
        .iter()
        .map(|turn| {
            // Images first, then the words about them: Anthropic's guidance
            // for best results with photos.
            let mut content: Vec<Value> = turn
                .images
                .iter()
                .map(|image| {
                    json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image.media_type,
                            "data": image.data,
                        }
                    })
                })
                .collect();
            if !turn.text.trim().is_empty() {
                content.push(json!({ "type": "text", "text": turn.text }));
            }
            json!({
                "role": match turn.speaker {
                    Speaker::User => "user",
                    Speaker::Assistant => "assistant",
                },
                "content": content,
            })
        })
        .collect();

    // No `temperature`: Claude 4.7 and later return a 400 for any value below 1.
    let mut body = json!({
        "model": request.model,
        "max_tokens": request.max_tokens,
        "messages": messages,
    });
    if !request.system.trim().is_empty() {
        body["system"] = json!(request.system);
    }
    if request.no_thinking && request.model == HAIKU {
        body["thinking"] = json!({ "type": "disabled" });
    }
    Ok(body)
}

fn parse_reply(raw: &str) -> Result<TextCompletion> {
    #[derive(Deserialize)]
    struct Block {
        #[serde(rename = "type")]
        kind: String,
        #[serde(default)]
        text: String,
    }
    #[derive(Default, Deserialize)]
    struct Usage {
        #[serde(default)]
        input_tokens: u64,
        #[serde(default)]
        output_tokens: u64,
        #[serde(default)]
        cache_creation_input_tokens: u64,
        #[serde(default)]
        cache_read_input_tokens: u64,
    }
    #[derive(Deserialize)]
    struct Reply {
        #[serde(default)]
        content: Vec<Block>,
        #[serde(default)]
        stop_reason: Option<String>,
        #[serde(default)]
        usage: Usage,
    }

    let reply: Reply =
        serde_json::from_str(raw).context("Anthropic sent a reply we could not read")?;
    // Thinking blocks and tool blocks are not part of the answer.
    let content: String = reply
        .content
        .into_iter()
        .filter(|block| block.kind == "text")
        .map(|block| block.text)
        .collect();
    let usage = TokenUsage {
        input_tokens: reply.usage.input_tokens
            + reply.usage.cache_creation_input_tokens
            + reply.usage.cache_read_input_tokens,
        output_tokens: reply.usage.output_tokens,
    };
    // A cut-off paper looks complete to the parser and fails later, so it is an
    // error here. Callers that must still count the tokens downcast to `Stopped`.
    let reason = match reply.stop_reason.as_deref() {
        Some("max_tokens") => Some(StopReason::TooLong),
        Some("refusal") => Some(StopReason::Refused),
        _ => None,
    };
    if let Some(reason) = reason {
        return Err(Stopped {
            reason,
            partial: content,
            usage,
        }
        .into());
    }
    if content.trim().is_empty() {
        bail!("Anthropic sent an empty reply");
    }
    Ok(TextCompletion { content, usage })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn turn(speaker: Speaker, text: &str) -> Turn {
        Turn {
            speaker,
            text: text.into(),
            images: vec![],
        }
    }

    fn request(model: &str, no_thinking: bool, turns: Vec<Turn>) -> Request<'_> {
        Request {
            model,
            system: "be brief",
            turns,
            max_tokens: 500,
            no_thinking,
        }
    }

    #[test]
    fn body_has_no_temperature_and_merges_neighbouring_turns() {
        let body = build_body(&request(
            HAIKU,
            false,
            vec![
                turn(Speaker::User, "reference"),
                turn(Speaker::User, "question"),
            ],
        ))
        .unwrap();
        assert!(body.get("temperature").is_none());
        assert!(body.get("thinking").is_none());
        assert_eq!(body["system"], "be brief");
        assert_eq!(body["max_tokens"], 500);
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["content"][0]["text"], "reference\n\nquestion");
    }

    #[test]
    fn only_haiku_is_told_to_skip_thinking() {
        let turns = || vec![turn(Speaker::User, "hi")];
        let haiku = build_body(&request(HAIKU, true, turns())).unwrap();
        assert_eq!(haiku["thinking"]["type"], "disabled");
        // Sonnet 5.5 answers `disabled` with a 400.
        let sonnet = build_body(&request(SONNET, true, turns())).unwrap();
        assert!(sonnet.get("thinking").is_none());
    }

    #[test]
    fn images_come_before_the_words_about_them() {
        let mut ask = turn(Speaker::User, "What does this say?");
        ask.images.push(Image {
            media_type: "image/jpeg".into(),
            data: "AAAA".into(),
        });
        let body = build_body(&request(HAIKU, false, vec![ask])).unwrap();
        let content = &body["messages"][0]["content"];
        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[0]["source"]["media_type"], "image/jpeg");
        assert_eq!(content[0]["source"]["data"], "AAAA");
        assert_eq!(content[1]["type"], "text");
    }

    #[test]
    fn a_conversation_must_start_and_end_with_the_user() {
        assert!(build_body(&request(HAIKU, false, vec![])).is_err());
        assert!(build_body(&request(
            HAIKU,
            false,
            vec![turn(Speaker::Assistant, "hello")]
        ))
        .is_err());
        assert!(build_body(&request(
            HAIKU,
            false,
            vec![turn(Speaker::User, "a"), turn(Speaker::Assistant, "b")]
        ))
        .is_err());
    }

    #[test]
    fn reply_keeps_text_blocks_and_counts_every_input_token() {
        let reply = parse_reply(
            r#"{"content":[{"type":"thinking","thinking":""},{"type":"text","text":"Hello"},{"type":"text","text":" there"}],
                "stop_reason":"end_turn",
                "usage":{"input_tokens":10,"cache_read_input_tokens":5,"output_tokens":7}}"#,
        )
        .unwrap();
        assert_eq!(reply.content, "Hello there");
        assert_eq!(reply.usage.input_tokens, 15);
        assert_eq!(reply.usage.output_tokens, 7);
    }

    #[test]
    fn truncated_refused_and_empty_replies_are_errors_that_keep_what_arrived() {
        let cut = parse_reply(
            r#"{"content":[{"type":"text","text":"half a pa"}],"stop_reason":"max_tokens",
                "usage":{"input_tokens":4,"output_tokens":700}}"#,
        )
        .unwrap_err();
        let stopped = cut.downcast_ref::<Stopped>().expect("a Stopped error");
        assert_eq!(stopped.reason, StopReason::TooLong);
        assert_eq!(stopped.partial, "half a pa");
        assert_eq!(stopped.usage.output_tokens, 700);

        let refused = parse_reply(r#"{"content":[],"stop_reason":"refusal"}"#).unwrap_err();
        assert_eq!(
            refused.downcast_ref::<Stopped>().map(|s| s.reason),
            Some(StopReason::Refused)
        );

        // Nothing to show is a plain error, not a Stopped one.
        let empty = parse_reply(r#"{"content":[{"type":"thinking"}],"stop_reason":"end_turn"}"#)
            .unwrap_err();
        assert!(empty.downcast_ref::<Stopped>().is_none());
    }

    /// A one-shot local server: returns the raw request it received.
    async fn serve_once(status: &str, body: &str) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let reply = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut chunk = [0u8; 8192];
            loop {
                let read = socket.read(&mut chunk).await.unwrap();
                if read == 0 {
                    break;
                }
                received.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&received).to_string();
                if let Some(split) = text.find("\r\n\r\n") {
                    let length = text[..split]
                        .to_ascii_lowercase()
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: ").map(str::to_owned))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if received.len() >= split + 4 + length {
                        break;
                    }
                }
            }
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&received).into_owned()
        });
        (root, handle)
    }

    #[tokio::test]
    async fn a_full_request_carries_the_key_version_and_body() {
        let (root, seen) = serve_once(
            "200 OK",
            r#"{"content":[{"type":"text","text":"Fine."}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":1}}"#,
        )
        .await;
        let client = AnthropicClient::with_root("sk-test", &root);
        let completion = client
            .complete(&request(HAIKU, true, vec![turn(Speaker::User, "hi")]))
            .await
            .unwrap();
        assert_eq!(completion.content, "Fine.");
        let raw = seen.await.unwrap().to_ascii_lowercase();
        assert!(raw.starts_with("post /messages "));
        assert!(raw.contains("x-api-key: sk-test"));
        assert!(raw.contains(&format!("anthropic-version: {API_VERSION}")));
        assert!(raw.contains("\"model\":\"claude-haiku-5-5\""));
        assert!(raw.contains("\"thinking\":{\"type\":\"disabled\"}"));
        assert!(!raw.contains("temperature"));
    }

    #[tokio::test]
    async fn the_providers_own_error_message_is_passed_on() {
        let (root, _seen) = serve_once(
            "400 Bad Request",
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"credit balance is too low"}}"#,
        )
        .await;
        let error = AnthropicClient::with_root("sk-test", &root)
            .complete(&request(HAIKU, false, vec![turn(Speaker::User, "hi")]))
            .await
            .unwrap_err();
        assert_eq!(format!("{error:#}"), "credit balance is too low");
    }

    #[tokio::test]
    async fn reachable_follows_whether_the_key_is_accepted() {
        let (root, _seen) = serve_once("200 OK", r#"{"data":[]}"#).await;
        assert!(
            AnthropicClient::with_root("sk-test", &root)
                .reachable()
                .await
        );
        let (root, _seen) = serve_once(
            "401 Unauthorized",
            r#"{"type":"error","error":{"type":"authentication_error","message":"bad key"}}"#,
        )
        .await;
        assert!(!AnthropicClient::with_root("nope", &root).reachable().await);
    }
}
