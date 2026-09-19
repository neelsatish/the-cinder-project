//! The Host's TLS identity and the listener that serves classroom traffic.
//!
//! Host creates one self-signed certificate on first start and keeps it. Apps
//! pin that certificate the first time they connect (see
//! `cinder_core::host_client`), so it must survive restarts, school resets and
//! restores: callers keep it outside the school-data folder.
//!
//! One port serves both protocols. TLS is the classroom protocol. Plain HTTP is
//! answered in full only for this computer (local development, where browsers
//! cannot pin a certificate); from any other computer it gets 426, which older
//! apps show as "update this app".

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::extract::ConnectInfo;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::{Extension, Json, Router};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use hyper_util::server::graceful::GracefulShutdown;
use hyper_util::service::TowerToHyperService;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio_rustls::TlsAcceptor;

const CERT_FILE: &str = "host-tls-cert.der";
const KEY_SECRET: &str = "host-tls-key";
/// A connection that sends nothing in this long is dropped before it can hold
/// a task, and a TLS handshake gets the same budget.
const FIRST_BYTE_TIMEOUT: Duration = Duration::from_secs(10);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct TlsIdentity {
    pub config: Arc<rustls::ServerConfig>,
    /// SHA-256 of the certificate, lowercase hex: what apps pin.
    pub fingerprint: String,
}

impl TlsIdentity {
    /// The fingerprint in short groups, for a person to compare by eye.
    pub fn display_fingerprint(&self) -> String {
        self.fingerprint
            .as_bytes()
            .chunks(4)
            .take(8)
            .map(|chunk| String::from_utf8_lossy(chunk).to_uppercase())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Loads the identity kept in `dir`, creating it on first use. The private key
/// is stored with `secure_store` (Windows DPAPI, or an owner-only key on Linux).
pub fn load_or_create_identity(dir: &Path) -> Result<TlsIdentity> {
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let cert_path = dir.join(CERT_FILE);
    let stored_key = cinder_core::secure_store::load(dir, KEY_SECRET)?;
    let (cert, key) = match (std::fs::read(&cert_path).ok(), stored_key) {
        (Some(cert), Some(key)) => (cert, key),
        _ => {
            let generated = rcgen::generate_simple_self_signed(vec![
                "cinder-host.local".to_owned(),
                "localhost".to_owned(),
            ])
            .context("generating the Host certificate")?;
            let cert = generated.cert.der().to_vec();
            let key = generated.key_pair.serialize_der();
            // Key first: a certificate without its key would be regenerated,
            // which every app would then reject as a changed identity.
            cinder_core::secure_store::store(dir, KEY_SECRET, &key)?;
            std::fs::write(&cert_path, &cert)
                .with_context(|| format!("writing {}", cert_path.display()))?;
            (cert, key)
        }
    };
    identity_from(cert, key)
}

fn identity_from(cert: Vec<u8>, key: Vec<u8>) -> Result<TlsIdentity> {
    let fingerprint = hex::encode(Sha256::digest(&cert));
    let mut config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()?
    .with_no_client_auth()
    .with_single_cert(
        vec![CertificateDer::from(cert)],
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key)),
    )
    .context("loading the Host certificate")?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(TlsIdentity {
        config: Arc::new(config),
        fingerprint,
    })
}

async fn upgrade_required() -> impl IntoResponse {
    (
        StatusCode::UPGRADE_REQUIRED,
        [(header::UPGRADE, "TLS/1.3")],
        Json(serde_json::json!({
            "error": "upgrade_required",
            "message": "This Cinder app is out of date. Update it to connect to this Host securely.",
        })),
    )
}

/// Serves `app` on `listener` until `shutdown` resolves, then gives open
/// connections a few seconds to finish.
pub async fn serve(
    listener: tokio::net::TcpListener,
    app: Router,
    identity: TlsIdentity,
    shutdown: impl std::future::Future<Output = ()>,
) -> Result<()> {
    let acceptor = TlsAcceptor::from(identity.config);
    let legacy = Router::new().fallback(upgrade_required);
    let graceful = GracefulShutdown::new();
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, peer) = match accepted {
                    Ok(accepted) => accepted,
                    Err(error) => {
                        // Usually a client that reset mid-handshake or a full
                        // file table; neither should stop the server.
                        tracing::warn!(?error, "accepting a connection failed");
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        continue;
                    }
                };
                let acceptor = acceptor.clone();
                let app = app.clone();
                let legacy = legacy.clone();
                let watcher = graceful.watcher();
                tokio::spawn(async move {
                    if let Err(error) =
                        serve_connection(stream, peer, app, legacy, acceptor, watcher).await
                    {
                        tracing::debug!(%peer, ?error, "connection ended with an error");
                    }
                });
            }
            _ = &mut shutdown => break,
        }
    }
    drop(listener);
    let _ = tokio::time::timeout(DRAIN_TIMEOUT, graceful.shutdown()).await;
    Ok(())
}

/// TLS records start with 0x16 (handshake); HTTP requests start with a letter.
fn looks_like_tls(first_byte: u8) -> bool {
    first_byte == 0x16
}

async fn serve_connection(
    stream: TcpStream,
    peer: SocketAddr,
    app: Router,
    legacy: Router,
    acceptor: TlsAcceptor,
    watcher: hyper_util::server::graceful::Watcher,
) -> Result<()> {
    let _ = stream.set_nodelay(true);
    let mut first = [0u8; 1];
    let read = tokio::time::timeout(FIRST_BYTE_TIMEOUT, stream.peek(&mut first)).await??;
    if read == 0 {
        return Ok(());
    }
    let builder = auto::Builder::new(TokioExecutor::new());
    let app = app.layer(Extension(ConnectInfo(peer)));
    if looks_like_tls(first[0]) {
        let tls = tokio::time::timeout(FIRST_BYTE_TIMEOUT, acceptor.accept(stream)).await??;
        let connection = builder
            .serve_connection(TokioIo::new(tls), TowerToHyperService::new(app))
            .into_owned();
        watcher
            .watch(connection)
            .await
            .map_err(|error| anyhow::anyhow!(error))?;
    } else {
        let service = if peer.ip().is_loopback() { app } else { legacy };
        let connection = builder
            .serve_connection(TokioIo::new(stream), TowerToHyperService::new(service))
            .into_owned();
        watcher
            .watch(connection)
            .await
            .map_err(|error| anyhow::anyhow!(error))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tls_is_told_apart_from_plain_http() {
        assert!(looks_like_tls(0x16));
        for method in b"GPDOH" {
            assert!(!looks_like_tls(*method));
        }
    }

    use cinder_core::host_client::{send, HostRequestError, RequestMeta};

    async fn start(dir: &Path) -> (u16, TlsIdentity, tokio::sync::oneshot::Sender<()>) {
        let state = crate::AppState::open(dir, cinder_ai::Ai::disabled()).unwrap();
        let identity = load_or_create_identity(&dir.join("tls")).unwrap();
        let listener = crate::bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(crate::serve_on_with_shutdown(
            state,
            listener,
            identity.clone(),
            async {
                let _ = stopped.await;
            },
        ));
        (port, identity, stop)
    }

    fn get(port: u16, path: &str) -> RequestMeta {
        RequestMeta {
            url: format!("http://127.0.0.1:{port}{path}"),
            method: "GET".into(),
            headers: vec![],
            timeout_ms: Some(5_000),
        }
    }

    #[tokio::test]
    async fn apps_pin_the_host_and_refuse_any_other_certificate() {
        let (school, other_school, pins) = (
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
        );
        let (port, identity, _stop) = start(school.path()).await;

        // First contact, over TLS, pins this Host's certificate.
        let health = send(pins.path(), &[], get(port, "/api/health"), vec![])
            .await
            .unwrap();
        assert_eq!(health.status, 200);
        let header = |name: &str| {
            health
                .headers
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        };
        assert_eq!(header("x-content-type-options").as_deref(), Some("nosniff"));
        assert_eq!(header("cache-control").as_deref(), Some("no-store"));
        let saved = std::fs::read_to_string(pins.path().join("trusted-hosts.json")).unwrap();
        assert!(saved.contains(&identity.fingerprint));
        let again = send(pins.path(), &[], get(port, "/api/health"), vec![])
            .await
            .unwrap();
        assert_eq!(again.status, 200);

        // A different Host at an address pinned to the first one is refused.
        let (other_port, other, _stop_other) = start(other_school.path()).await;
        assert_ne!(other.fingerprint, identity.fingerprint);
        let mut pinned = std::collections::HashMap::new();
        pinned.insert(
            format!("127.0.0.1:{other_port}"),
            identity.fingerprint.clone(),
        );
        std::fs::write(
            pins.path().join("trusted-hosts.json"),
            serde_json::to_vec(&pinned).unwrap(),
        )
        .unwrap();
        let refused = send(pins.path(), &[], get(other_port, "/api/health"), vec![]).await;
        assert!(matches!(refused, Err(HostRequestError::IdentityChanged)));

        // Plain HTTP is still answered for this computer (local development).
        let plain = reqwest::get(format!("http://127.0.0.1:{port}/api/health"))
            .await
            .unwrap();
        assert_eq!(plain.status(), 200);
    }

    #[tokio::test]
    async fn a_host_that_only_speaks_plain_http_is_reported_as_outdated() {
        let (school, pins) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let state = crate::AppState::open(school.path(), cinder_ai::Ai::disabled()).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // How Cinder Host 0.10.6 and earlier served: plain HTTP only.
        tokio::spawn(async move { axum::serve(listener, crate::router(state)).await });
        let result = send(pins.path(), &[], get(port, "/api/health"), vec![]).await;
        assert!(
            matches!(result, Err(HostRequestError::HostOutdated)),
            "{:?}",
            result.err()
        );
        assert!(!pins.path().join("trusted-hosts.json").exists());
    }

    #[tokio::test]
    async fn older_apps_on_other_computers_are_told_to_update() {
        use tower::ServiceExt;
        let response = Router::new()
            .fallback(upgrade_required)
            .oneshot(
                axum::http::Request::get("/api/health")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UPGRADE_REQUIRED);
    }

    #[test]
    fn the_identity_is_created_once_and_then_kept() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create_identity(dir.path()).unwrap();
        let second = load_or_create_identity(dir.path()).unwrap();
        assert_eq!(first.fingerprint, second.fingerprint);
        assert_eq!(first.fingerprint.len(), 64);
        assert_eq!(first.display_fingerprint().split(' ').count(), 8);
    }
}
