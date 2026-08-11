//! Password hashing, session tokens, and the `CurrentUser` extractor.

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use chrono::{DateTime, Duration, Utc};
use cinder_core::{Role, User};
use rand::RngCore;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::HostError;
use crate::AppState;

/// How long a login lasts. Long, on purpose: students should not be locked out
/// mid-session by an expiry, and the LAN has no route to the internet.
pub const SESSION_DAYS: i64 = 30;
pub const MAX_PASSWORD_CHARS: usize = 1_024;

pub fn hash_password(password: &str) -> Result<String, HostError> {
    if password.chars().count() < 8 {
        return Err(HostError::BadRequest(
            "Password must be at least 8 characters.".into(),
        ));
    }
    hash_secret(password)
}

pub fn hash_temporary_pin(pin: &str) -> Result<String, HostError> {
    if pin.len() != 4 || !pin.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(HostError::BadRequest(
            "A temporary PIN must contain exactly four digits.".into(),
        ));
    }
    hash_secret(pin)
}

fn hash_secret(secret: &str) -> Result<String, HostError> {
    if secret.chars().count() > MAX_PASSWORD_CHARS {
        return Err(HostError::BadRequest(
            "Password or recovery value is too long.".into(),
        ));
    }

    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| HostError::Other(anyhow::anyhow!("hashing password: {e}")))
}

/// Returns false for a malformed stored hash rather than erroring, so one
/// corrupt row cannot be used to distinguish accounts.
pub fn verify_password(stored_hash: &str, password: &str) -> bool {
    if password.chars().count() > MAX_PASSWORD_CHARS {
        return false;
    }
    let Ok(parsed) = PasswordHash::new(stored_hash) else {
        tracing::error!("stored password hash is malformed");
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// A fresh session token. Returns `(plaintext, digest)` — the plaintext goes to
/// the client exactly once and the digest is what we store, so a stolen copy of
/// the database cannot be replayed as a login.
pub fn new_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let plaintext = hex::encode(bytes);
    let digest = digest_token(&plaintext);
    (plaintext, digest)
}

pub fn digest_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn session_expiry(now: DateTime<Utc>) -> DateTime<Utc> {
    now + Duration::days(SESSION_DAYS)
}

/// The signed-in user, resolved from the `Authorization: Bearer <token>` header.
#[derive(Debug, Clone)]
pub struct CurrentUser(pub User, pub String);

impl CurrentUser {
    pub fn require_teacher(&self) -> Result<(), HostError> {
        if self.0.role.is_teacher() {
            Ok(())
        } else {
            Err(HostError::Forbidden)
        }
    }

    pub fn id(&self) -> Uuid {
        self.0.id
    }

    pub fn token_digest(&self) -> &str {
        &self.1
    }
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = HostError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let request_path = parts.uri.path().to_owned();
        let token = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(HostError::Unauthenticated)?
            .to_owned();

        let pool = state.pool.clone();
        let user = tokio::task::spawn_blocking(move || lookup_session(&pool, &token))
            .await
            .map_err(|e| HostError::Other(anyhow::anyhow!("session lookup panicked: {e}")))??;

        if user.0.must_change_password
            && !matches!(
                request_path.as_str(),
                "/api/auth/change-password" | "/api/auth/logout" | "/api/me"
            )
        {
            return Err(HostError::Forbidden);
        }

        Ok(user)
    }
}

fn lookup_session(pool: &crate::db::Pool, token: &str) -> Result<CurrentUser, HostError> {
    let conn = pool.get()?;
    let digest = digest_token(token);

    let row = conn
        .query_row(
            "SELECT u.id, u.username, u.display_name, u.role, u.created_at, s.expires_at,
                    u.disabled_at, u.grade_level, u.section, u.roll_number, u.must_change_password
               FROM sessions s
               JOIN users u ON u.id = s.user_id
              WHERE s.token = ?1",
            [&digest],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, bool>(10)?,
                ))
            },
        )
        .optional()?
        .ok_or(HostError::Unauthenticated)?;

    let (
        id,
        username,
        display_name,
        role,
        created_at,
        expires_at,
        disabled_at,
        grade_level,
        section,
        roll_number,
        must_change_password,
    ) = row;

    if disabled_at.is_some() {
        return Err(HostError::Forbidden);
    }

    let expires: DateTime<Utc> = expires_at
        .parse::<DateTime<Utc>>()
        .map_err(|e| HostError::Other(anyhow::anyhow!("unparseable session expiry: {e}")))?;
    if expires <= Utc::now() {
        // Clear it out so the sessions table does not grow forever on a machine
        // nobody ever administers.
        let _ = conn.execute("DELETE FROM sessions WHERE token = ?1", [&digest]);
        return Err(HostError::Unauthenticated);
    }

    Ok(CurrentUser(
        User {
            id: id
                .parse()
                .map_err(|e| HostError::Other(anyhow::anyhow!("bad user id in database: {e}")))?,
            username,
            display_name,
            role: role
                .parse::<Role>()
                .map_err(|e| HostError::Other(anyhow::anyhow!("{e}")))?,
            grade_level,
            section,
            roll_number,
            must_change_password,
            created_at: created_at
                .parse()
                .map_err(|e| HostError::Other(anyhow::anyhow!("bad created_at: {e}")))?,
        },
        digest,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_password() {
        let hash = hash_password("optics123").unwrap();
        assert!(verify_password(&hash, "optics123"));
        assert!(!verify_password(&hash, "optics124"));
    }

    #[test]
    fn hash_is_salted() {
        let a = hash_password("same-password").unwrap();
        let b = hash_password("same-password").unwrap();
        assert_ne!(a, b, "two hashes of one password must differ");
    }

    #[test]
    fn rejects_a_too_short_password() {
        assert!(hash_password("short").is_err());
    }

    #[test]
    fn temporary_pin_has_a_separate_narrow_policy() {
        let hash = hash_temporary_pin("0427").unwrap();
        assert!(verify_password(&hash, "0427"));
        assert!(hash_temporary_pin("427").is_err());
        assert!(hash_temporary_pin("four").is_err());
    }

    #[test]
    fn oversized_secrets_are_rejected_before_argon2() {
        let oversized = "x".repeat(MAX_PASSWORD_CHARS + 1);
        assert!(hash_password(&oversized).is_err());
        assert!(!verify_password(DUMMY_TEST_HASH, &oversized));
    }

    #[test]
    fn malformed_hash_verifies_false_instead_of_panicking() {
        assert!(!verify_password("not-a-phc-string", "anything"));
    }

    #[test]
    fn tokens_are_unique_and_stored_only_as_a_digest() {
        let (plain_a, digest_a) = new_token();
        let (plain_b, _) = new_token();

        assert_ne!(plain_a, plain_b);
        assert_ne!(
            plain_a, digest_a,
            "we must not store the bearer token itself"
        );
        assert_eq!(
            digest_a,
            digest_token(&plain_a),
            "digest must be reproducible"
        );
    }

    const DUMMY_TEST_HASH: &str =
        "$argon2id$v=19$m=19456,t=2,p=1$c3R1ZHlib3hkdW1teXNhbHQ$b3JCJ0N0k1Zj3iWQxk7yLXJ7l1RfQvJmVXQ0kx5s2Yc";
}
