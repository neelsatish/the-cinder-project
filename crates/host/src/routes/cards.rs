//! Private flashcard decks and manual cards.

use axum::extract::{Path, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::Utc;
use lumina_core::{Card, CardOrigin, CreateCardRequest};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::error::{HostError, HostResult};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/decks/{id}/cards", get(list).post(create))
        .route("/api/cards/{id}", delete(remove))
}

async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(deck_id): Path<Uuid>,
) -> HostResult<Json<Vec<Card>>> {
    let owner = user.id();
    state
        .db(move |conn| {
            assert_owned_deck(conn, deck_id, owner)?;
            let mut stmt = conn.prepare(
                "SELECT id, deck_node_id, front, back, source_node_id, source_excerpt, generated_by
                   FROM cards WHERE deck_node_id = ?1 ORDER BY created_at, id",
            )?;
            let rows = stmt
                .query_map([deck_id.to_string()], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let cards = rows
                .into_iter()
                .map(|row| {
                    Ok(Card {
                        id: parse_uuid(&row.0, "card")?,
                        deck_node_id: parse_uuid(&row.1, "deck")?,
                        front: row.2,
                        back: row.3,
                        source_node_id: row
                            .4
                            .map(|value| parse_uuid(&value, "source node"))
                            .transpose()?,
                        source_excerpt: row.5,
                        generated_by: match row.6.as_str() {
                            "manual" => CardOrigin::Manual,
                            "ai" => CardOrigin::Ai,
                            _ => return Err(HostError::Other(anyhow::anyhow!("bad card origin"))),
                        },
                    })
                })
                .collect::<HostResult<Vec<_>>>()?;
            Ok(Json(cards))
        })
        .await
}

async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(deck_id): Path<Uuid>,
    Json(req): Json<CreateCardRequest>,
) -> HostResult<Json<Card>> {
    let owner = user.id();
    state
        .db(move |conn| {
            assert_owned_deck(conn, deck_id, owner)?;
            let front = req.front.trim();
            let back = req.back.trim();
            if front.is_empty() || back.is_empty() {
                return Err(HostError::BadRequest(
                    "Both sides of a flashcard are required.".into(),
                ));
            }
            if let Some(source_id) = req.source_node_id {
                let owner_id = owner.to_string();
                let source_owner: Option<String> = conn
                    .query_row(
                        "SELECT owner_id FROM nodes WHERE id = ?1",
                        [source_id.to_string()],
                        |row| row.get(0),
                    )
                    .optional()?
                    .ok_or(HostError::NotFound("source note"))?;
                if source_owner.as_deref() != Some(owner_id.as_str()) {
                    return Err(HostError::Forbidden);
                }
            }
            let id = Uuid::new_v4();
            conn.execute(
                "INSERT INTO cards
                    (id, deck_node_id, front, back, source_node_id, source_excerpt, generated_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual', ?7)",
                rusqlite::params![
                    id.to_string(),
                    deck_id.to_string(),
                    front,
                    back,
                    req.source_node_id.map(|value| value.to_string()),
                    req.source_excerpt,
                    Utc::now().to_rfc3339(),
                ],
            )?;
            Ok(Json(Card {
                id,
                deck_node_id: deck_id,
                front: front.to_owned(),
                back: back.to_owned(),
                source_node_id: req.source_node_id,
                source_excerpt: req.source_excerpt,
                generated_by: CardOrigin::Manual,
            }))
        })
        .await
}

async fn remove(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(card_id): Path<Uuid>,
) -> HostResult<Json<serde_json::Value>> {
    let owner = user.id().to_string();
    state
        .db(move |conn| {
            let changed = conn.execute(
                "DELETE FROM cards WHERE id = ?1 AND deck_node_id IN (
                    SELECT id FROM nodes WHERE owner_id = ?2 AND kind = 'deck'
                 )",
                rusqlite::params![card_id.to_string(), owner],
            )?;
            if changed == 0 {
                return Err(HostError::NotFound("flashcard"));
            }
            Ok(Json(serde_json::json!({ "ok": true })))
        })
        .await
}

fn assert_owned_deck(conn: &rusqlite::Connection, deck_id: Uuid, owner: Uuid) -> HostResult<()> {
    let found: Option<(Option<String>, String)> = conn
        .query_row(
            "SELECT owner_id, kind FROM nodes WHERE id = ?1",
            [deck_id.to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match found {
        Some((Some(found_owner), kind)) if found_owner == owner.to_string() && kind == "deck" => {
            Ok(())
        }
        Some(_) => Err(HostError::Forbidden),
        None => Err(HostError::NotFound("deck")),
    }
}

fn parse_uuid(value: &str, what: &str) -> HostResult<Uuid> {
    value
        .parse()
        .map_err(|error| HostError::Other(anyhow::anyhow!("bad {what} id: {error}")))
}
