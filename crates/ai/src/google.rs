//! Google Gemini, spoken natively rather than through the OpenAI-compatible
//! shape used by [`crate::ChatClient`].
//!
//! Two capabilities need the native API: search grounding, which finds official
//! past papers, and image input, which locates the figures inside them. Paper
//! text generation still goes through `ChatClient`, so a school running a local
//! model keeps working without a Google key.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use cinder_core::{PaperCandidate, PaperFigure, PaperPageImage};
use serde::Deserialize;

use crate::{read_limited_response, upstream_error, MAX_PROVIDER_RESPONSE_BYTES};

const API_ROOT: &str = "https://generativelanguage.googleapis.com/v1beta/models";
pub const DEFAULT_MODEL: &str = "gemini-2.5-flash";

pub struct GoogleClient {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl GoogleClient {
    pub fn new(api_key: &str, model: &str) -> Self {
        // The model name goes into the request path, so anything outside a
        // model slug is rejected rather than escaped.
        let model = model.trim();
        let usable = !model.is_empty()
            && model.len() <= 100
            && model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'));
        Self {
            api_key: api_key.to_owned(),
            model: if usable {
                model.to_owned()
            } else {
                DEFAULT_MODEL.to_owned()
            },
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("building an http client cannot fail"),
        }
    }

    pub async fn search_papers(&self, query: &str) -> Result<Vec<PaperCandidate>> {
        let query = query.trim();
        if query.is_empty() {
            bail!("describe the paper you are looking for");
        }

        let prompt = format!(
            "Find official past or specimen examination papers matching: {query}\n\n\
             Only use the examination board's own website. Never use a question bank, \
             tutoring site or file-sharing mirror. Return at most 8 results as a JSON \
             array and nothing else. Each element must have the keys title, url, board, \
             year, session, variant and snippet. url must be the direct link to the PDF \
             on the board's site. Use an empty string for anything you cannot establish; \
             never guess a URL."
        );

        // A request carrying the google_search tool cannot also ask for JSON
        // response mode, so the shape is requested in the prompt and extracted
        // from the reply.
        let body = serde_json::json!({
            "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
            "tools": [{ "google_search": {} }],
            "generationConfig": { "temperature": 0.2 },
        });

        let text = self.generate(&body).await?;
        let candidates: Vec<PaperCandidate> = serde_json::from_str(extract_json(&text))
            .context("the AI did not return a usable list of papers")?;

        Ok(candidates
            .into_iter()
            .filter(|candidate| !candidate.url.trim().is_empty())
            .take(8)
            .collect())
    }

    pub async fn find_figures(&self, pages: &[PaperPageImage]) -> Result<Vec<PaperFigure>> {
        if pages.is_empty() {
            bail!("no pages were supplied");
        }

        let mut parts = vec![serde_json::json!({
            "text": "Each image is one page of an examination paper, given in order. \
                     Find every diagram, graph, table, map or photograph a question \
                     depends on. Ignore headers, footers, logos, barcodes, page \
                     numbers and answer lines. Return one entry per figure with the \
                     1-based page number, a box that contains the whole figure \
                     including its labels, a short caption and alt text."
        })];
        for page in pages {
            parts.push(serde_json::json!({ "text": format!("Page {}", page.page) }));
            parts.push(serde_json::json!({
                "inline_data": { "mime_type": "image/jpeg", "data": page.jpeg_base64 }
            }));
        }

        let body = serde_json::json!({
            "contents": [{ "role": "user", "parts": parts }],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "page": { "type": "INTEGER" },
                            "box_2d": {
                                "type": "ARRAY",
                                "items": { "type": "INTEGER" },
                                "minItems": 4,
                                "maxItems": 4,
                            },
                            "caption": { "type": "STRING" },
                            "alt": { "type": "STRING" },
                        },
                        "required": ["page", "box_2d", "caption", "alt"],
                    },
                },
            },
        });

        let text = self.generate(&body).await?;
        let figures: Vec<PaperFigure> = serde_json::from_str(extract_json(&text))
            .context("the AI did not return usable figure positions")?;

        Ok(figures
            .into_iter()
            .filter(|figure| {
                let [top, left, bottom, right] = figure.box_2d;
                bottom > top && right > left && bottom <= 1000 && right <= 1000
            })
            .take(40)
            .collect())
    }

    async fn generate(&self, body: &serde_json::Value) -> Result<String> {
        let response = self
            .client
            .post(format!("{API_ROOT}/{}:generateContent", self.model))
            .header("x-goog-api-key", &self.api_key)
            .json(body)
            .send()
            .await
            .context("asking Google")?;

        let status = response.status();
        let raw = String::from_utf8_lossy(
            &read_limited_response(response, MAX_PROVIDER_RESPONSE_BYTES).await?,
        )
        .into_owned();

        if !status.is_success() {
            bail!(
                "{}",
                upstream_error(&raw).unwrap_or_else(|| format!("Google returned {status}"))
            );
        }

        #[derive(Deserialize)]
        struct Part {
            text: Option<String>,
        }
        #[derive(Deserialize)]
        struct Content {
            #[serde(default)]
            parts: Vec<Part>,
        }
        #[derive(Deserialize)]
        struct Candidate {
            content: Option<Content>,
        }
        #[derive(Deserialize)]
        struct Reply {
            #[serde(default)]
            candidates: Vec<Candidate>,
        }

        let parsed: Reply =
            serde_json::from_str(&raw).context("Google sent a reply we could not read")?;
        let text = parsed
            .candidates
            .into_iter()
            .next()
            .and_then(|candidate| candidate.content)
            .map(|content| {
                content
                    .parts
                    .into_iter()
                    .filter_map(|part| part.text)
                    .collect::<String>()
            })
            .unwrap_or_default();

        if text.trim().is_empty() {
            bail!("Google sent an empty reply");
        }
        Ok(text)
    }
}

/// Models wrap JSON in prose or a fenced block often enough that trusting the
/// reply verbatim fails in a classroom.
fn extract_json(text: &str) -> &str {
    let trimmed = text.trim().trim_start_matches("```json").trim_matches('`');
    let start = match (trimmed.find('['), trimmed.find('{')) {
        (Some(array), Some(object)) => array.min(object),
        (Some(array), None) => array,
        (None, Some(object)) => object,
        (None, None) => return trimmed,
    };
    let end = match trimmed.rfind(']').zip(trimmed.rfind('}')) {
        Some((array, object)) => array.max(object),
        None => match trimmed.rfind(']').or_else(|| trimmed.rfind('}')) {
            Some(index) => index,
            None => return trimmed,
        },
    };
    if end <= start {
        return trimmed;
    }
    trimmed[start..=end].trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_survives_fences_and_prose() {
        assert_eq!(extract_json("```json\n[{\"a\":1}]\n```"), "[{\"a\":1}]");
        assert_eq!(
            extract_json("Here you go: {\"a\":1} — hope that helps"),
            "{\"a\":1}"
        );
        assert_eq!(extract_json("[1,2]"), "[1,2]");
    }

    #[test]
    fn only_a_model_slug_reaches_the_request_path() {
        assert_eq!(GoogleClient::new("key", "  ").model, DEFAULT_MODEL);
        assert_eq!(
            GoogleClient::new("key", "gemini-2.5-pro").model,
            "gemini-2.5-pro"
        );
        for hostile in ["../../v1beta/models/x", "gemini:generateContent?key=leak"] {
            assert_eq!(GoogleClient::new("key", hostile).model, DEFAULT_MODEL);
        }
    }
}
