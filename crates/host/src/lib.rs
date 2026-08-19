//! The Cinder host: the teacher's machine holds all data and serves every
//! client on the lab LAN.
//!
//! The Cinder Teacher binary embeds this crate; the smaller Student binary only
//! contains discovery, connection configuration, and its client UI.

pub mod auth;
pub mod db;
pub mod discovery;
pub mod error;
pub mod routes;

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::http::{header, HeaderValue, Method};
use axum::Router;
use cinder_ai::Ai;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub pool: db::Pool,
    /// Content-addressed blob store: `files_dir/<sha[0..2]>/<sha>`.
    pub files_dir: PathBuf,
    pub ai: Arc<Ai>,
    /// Machine-local AES key used only to encrypt the cloud AI credential in SQLite.
    pub ai_key_secret: [u8; 32],
}

impl AppState {
    /// Opens the database and blob store under `data_dir`.
    pub fn open(data_dir: &Path, ai: Ai) -> Result<Self> {
        let database_path = migrate_legacy_database(data_dir)?;
        let pool = db::open(&database_path)?;
        let files_dir = data_dir.join("files");
        std::fs::create_dir_all(&files_dir)
            .with_context(|| format!("creating {}", files_dir.display()))?;
        let ai_key_secret =
            cinder_core::secure_store::load_or_create_key(&data_dir.join("ai-key-secret.bin"))?;

        Ok(Self {
            pool,
            files_dir,
            ai: Arc::new(ai),
            ai_key_secret,
        })
    }

    /// Runs a blocking database closure on the blocking pool.
    ///
    /// Every route goes through this. rusqlite is synchronous, and calling it
    /// directly from an async handler would stall the whole runtime the moment
    /// one query touches disk.
    pub async fn db<T, F>(&self, f: F) -> error::HostResult<T>
    where
        F: FnOnce(&mut db::PooledConn) -> error::HostResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let pool = self.pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get()?;
            f(&mut conn)
        })
        .await
        .map_err(|e| error::HostError::Other(anyhow::anyhow!("database task panicked: {e}")))?
    }
}

fn migrate_legacy_database(data_dir: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(data_dir)
        .with_context(|| format!("creating data directory {}", data_dir.display()))?;
    let current_name = "cinder.db";
    let current = data_dir.join(current_name);
    let legacy_name = format!("{}.db", cinder_core::previous_product_name());
    let legacy = data_dir.join(&legacy_name);
    if current.exists() || !legacy.exists() {
        return Ok(current);
    }

    for suffix in ["", "-wal", "-shm"] {
        let source = data_dir.join(format!("{legacy_name}{suffix}"));
        if source.exists() {
            let destination = data_dir.join(format!("{current_name}{suffix}"));
            std::fs::rename(&source, &destination).with_context(|| {
                format!(
                    "moving classroom data from {} to {}",
                    source.display(),
                    destination.display()
                )
            })?;
        }
    }
    Ok(current)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(routes::health::router())
        .merge(routes::auth::router())
        .merge(routes::assignments::router())
        .merge(routes::attendance::router())
        .merge(routes::cards::router())
        .merge(routes::classrooms::router())
        .merge(routes::dashboard::router())
        .merge(routes::tree::router())
        .merge(routes::notes::router())
        .merge(routes::files::router())
        .merge(routes::ai::router())
        // Uploads are capped in the handler, but the body limit has to be raised
        // here too or axum rejects a large scan before the handler ever runs.
        .layer(axum::extract::DefaultBodyLimit::max(
            cinder_core::MAX_UPLOAD_BYTES + 1024 * 1024,
        ))
        // Only packaged Cinder webviews and the two local development servers
        // may call the classroom host. A random website opened on a lab machine
        // must not be able to probe login or recovery endpoints on the LAN.
        .layer(cinder_cors())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

fn cinder_cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("tauri://localhost"),
            HeaderValue::from_static("http://tauri.localhost"),
            HeaderValue::from_static("https://tauri.localhost"),
            HeaderValue::from_static("http://localhost:5173"),
            HeaderValue::from_static("http://localhost:5174"),
            HeaderValue::from_static("http://127.0.0.1:5173"),
            HeaderValue::from_static("http://127.0.0.1:5174"),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::RANGE])
        .expose_headers([
            header::ACCEPT_RANGES,
            header::CONTENT_DISPOSITION,
            header::CONTENT_LENGTH,
            header::CONTENT_RANGE,
            header::CONTENT_TYPE,
        ])
}

/// Claims the port before anything else starts.
///
/// Separate from [`serve_on`] on purpose: binding inside the spawned server task
/// meant a port clash — an orphaned copy of the app still holding 7373 — surfaced
/// only as a log line, and the window opened anyway onto a host that was never
/// listening. The caller can now refuse to start and say why.
pub fn bind(addr: SocketAddr) -> Result<std::net::TcpListener> {
    let listener = std::net::TcpListener::bind(addr).with_context(|| format!("binding {addr}"))?;
    // tokio requires a non-blocking socket when adopting a std listener.
    listener
        .set_nonblocking(true)
        .context("setting the listener non-blocking")?;
    Ok(listener)
}

/// Serves on an already-bound listener until the process is asked to stop.
pub async fn serve_on(state: AppState, listener: std::net::TcpListener) -> Result<()> {
    let listener =
        tokio::net::TcpListener::from_std(listener).context("adopting the bound listener")?;

    let bound = listener.local_addr()?;
    tracing::info!(%bound, "host listening");

    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("serving")?;

    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}

#[cfg(test)]
mod data_migration_tests {
    use super::*;

    #[test]
    fn legacy_database_and_sidecars_are_renamed_together() {
        let directory = tempfile::tempdir().unwrap();
        let previous_name = format!("{}.db", cinder_core::previous_product_name());
        for suffix in ["", "-wal", "-shm"] {
            std::fs::write(
                directory.path().join(format!("{previous_name}{suffix}")),
                suffix,
            )
            .unwrap();
        }

        let current = migrate_legacy_database(directory.path()).unwrap();

        assert_eq!(current, directory.path().join("cinder.db"));
        for suffix in ["", "-wal", "-shm"] {
            assert!(directory.path().join(format!("cinder.db{suffix}")).exists());
            assert!(!directory
                .path()
                .join(format!("{previous_name}{suffix}"))
                .exists());
        }
    }
}
