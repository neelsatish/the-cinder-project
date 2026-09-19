//! HTTPS from a Cinder app to Cinder Host, pinned to the Host's certificate.
//!
//! Host generates its own self-signed certificate, so there is no certificate
//! authority to check against. Instead an app trusts the certificate it sees the
//! first time it reaches a Host address and refuses any other certificate for
//! that address afterwards, the way SSH treats a new server. Re-trusting a Host
//! (a replaced or reset Host computer) happens only when a person re-enters its
//! address; see [`forget`].
//!
//! The webview never talks to the network itself: every classroom request goes
//! through [`send`], so a certificate check cannot be skipped by page script.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const PIN_FILE: &str = "trusted-hosts.json";
/// A response larger than this is refused rather than buffered.
pub const MAX_RESPONSE_BYTES: usize = crate::MAX_UPLOAD_BYTES + 1024 * 1024;
const MAX_TIMEOUT: Duration = Duration::from_secs(300);

/// What the webview asks for. `url` must point at an allowed Host.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestMeta {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum HostRequestError {
    #[error(
        "host_identity_changed: This Host's security certificate is not the one this app \
         trusted. If your school replaced or reset its Host computer, open School connection \
         and enter the Host address again. Otherwise tell whoever runs the Host: another \
         computer may be pretending to be it."
    )]
    IdentityChanged,
    #[error("timeout: The Host did not respond in time.")]
    Timeout,
    #[error("offline: The Host is currently unreachable.")]
    Unreachable,
    #[error("invalid: {0}")]
    Invalid(String),
}

/// The origin (`host:port`) a pin is stored under.
fn origin(url: &reqwest::Url) -> Option<String> {
    Some(format!(
        "{}:{}",
        url.host_str()?.to_ascii_lowercase(),
        url.port_or_known_default()?
    ))
}

/// Parses a Host address and always returns it as HTTPS on the same port.
/// Addresses saved by older releases start with `http://`.
pub fn https_url(raw: &str) -> Result<reqwest::Url, HostRequestError> {
    let mut url = reqwest::Url::parse(raw.trim())
        .map_err(|_| HostRequestError::Invalid("That is not a valid Host address.".into()))?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(HostRequestError::Invalid(
            "The Host address cannot contain credentials.".into(),
        ));
    }
    match url.scheme() {
        "https" => {}
        "http" => {
            let port = url.port_or_known_default();
            url.set_scheme("https")
                .map_err(|_| HostRequestError::Invalid("Unsupported Host address.".into()))?;
            // An implicit port 80 must stay 80, not silently become 443.
            url.set_port(port)
                .map_err(|_| HostRequestError::Invalid("Unsupported Host address.".into()))?;
        }
        _ => {
            return Err(HostRequestError::Invalid(
                "The Host address must start with http:// or https://.".into(),
            ))
        }
    }
    if url.host_str().is_none() {
        return Err(HostRequestError::Invalid(
            "The Host address has no host.".into(),
        ));
    }
    Ok(url)
}

fn is_loopback(url: &reqwest::Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Whether `url` belongs to one of the allowed Host addresses. This computer is
/// always allowed, so a Teacher app on the Host machine works before setup.
pub fn is_allowed(url: &reqwest::Url, allowed: &[String]) -> bool {
    if is_loopback(url) {
        return true;
    }
    let Some(target) = origin(url) else {
        return false;
    };
    allowed.iter().any(|candidate| {
        https_url(candidate)
            .ok()
            .and_then(|parsed| origin(&parsed))
            .is_some_and(|candidate| candidate == target)
    })
}

#[derive(Debug)]
struct PinnedVerifier {
    expected: Option<[u8; 32]>,
    seen: Mutex<Option<[u8; 32]>>,
    mismatch: AtomicBool,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let digest: [u8; 32] = Sha256::digest(end_entity.as_ref()).into();
        *self.seen.lock().unwrap_or_else(|error| error.into_inner()) = Some(digest);
        match self.expected {
            Some(expected) if expected != digest => {
                self.mismatch.store(true, Ordering::SeqCst);
                Err(rustls::Error::General("host identity changed".into()))
            }
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    // The handshake signature is still checked, so a server can only present
    // the pinned certificate if it holds that certificate's private key.
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

struct Pinned {
    client: reqwest::Client,
    verifier: Arc<PinnedVerifier>,
}

fn build_client(expected: Option<[u8; 32]>) -> Result<Pinned, HostRequestError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PinnedVerifier {
        expected,
        seen: Mutex::new(None),
        mismatch: AtomicBool::new(false),
        provider: provider.clone(),
    });
    let tls = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| HostRequestError::Invalid(error.to_string()))?
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_no_client_auth();
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        // A redirect could only lead away from the pinned Host.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| HostRequestError::Invalid(error.to_string()))?;
    Ok(Pinned { client, verifier })
}

fn pin_path(dir: &Path) -> PathBuf {
    dir.join(PIN_FILE)
}

fn read_pins(dir: &Path) -> HashMap<String, String> {
    std::fs::read(pin_path(dir))
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default()
}

fn write_pins(dir: &Path, pins: &HashMap<String, String>) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = pin_path(dir);
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(pins)?)?;
    std::fs::rename(temporary, path)
}

fn decode_pin(hex_pin: &str) -> Option<[u8; 32]> {
    hex::decode(hex_pin).ok()?.try_into().ok()
}

/// Cached clients keep connections alive between requests; one per Host.
fn clients() -> &'static Mutex<HashMap<String, Arc<Pinned>>> {
    static CLIENTS: OnceLock<Mutex<HashMap<String, Arc<Pinned>>>> = OnceLock::new();
    CLIENTS.get_or_init(Default::default)
}

fn client_for(dir: &Path, key: &str) -> Result<Arc<Pinned>, HostRequestError> {
    let mut cache = clients().lock().unwrap_or_else(|error| error.into_inner());
    if let Some(existing) = cache.get(key) {
        return Ok(existing.clone());
    }
    let expected = read_pins(dir).get(key).and_then(|pin| decode_pin(pin));
    let pinned = Arc::new(build_client(expected)?);
    cache.insert(key.to_owned(), pinned.clone());
    Ok(pinned)
}

/// Forgets the certificate trusted for `base_url`, so the next connection
/// trusts whatever that Host presents. Only call this on a person's request.
pub fn forget(dir: &Path, base_url: &str) -> std::io::Result<()> {
    let Some(key) = https_url(base_url).ok().as_ref().and_then(origin) else {
        return Ok(());
    };
    clients()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&key);
    let mut pins = read_pins(dir);
    if pins.remove(&key).is_some() {
        write_pins(dir, &pins)?;
    }
    Ok(())
}

pub struct HostResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Sends one request to an allowed Host over pinned HTTPS.
///
/// `dir` holds the pin file; `allowed` lists the Host addresses this app may
/// contact (its saved Host and one being set up).
pub async fn send(
    dir: &Path,
    allowed: &[String],
    meta: RequestMeta,
    body: Vec<u8>,
) -> Result<HostResponse, HostRequestError> {
    let url = https_url(&meta.url)?;
    if !is_allowed(&url, allowed) {
        return Err(HostRequestError::Invalid(
            "This app only talks to its own Cinder Host.".into(),
        ));
    }
    let key = origin(&url)
        .ok_or_else(|| HostRequestError::Invalid("The Host address has no port.".into()))?;
    let method = reqwest::Method::from_bytes(meta.method.to_ascii_uppercase().as_bytes())
        .map_err(|_| HostRequestError::Invalid("Unsupported request method.".into()))?;
    let timeout = meta
        .timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(Duration::from_secs(30))
        .min(MAX_TIMEOUT);

    let pinned = client_for(dir, &key)?;
    let mut request = pinned.client.request(method, url).timeout(timeout);
    for (name, value) in &meta.headers {
        // The transport sets these itself; forwarding them could desync framing.
        if matches!(
            name.to_ascii_lowercase().as_str(),
            "host" | "content-length" | "connection" | "transfer-encoding"
        ) {
            continue;
        }
        request = request.header(name, value);
    }
    if !body.is_empty() {
        request = request.body(body);
    }

    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            if pinned.verifier.mismatch.load(Ordering::SeqCst) {
                // Drop the client so a later forget-and-retry starts clean.
                clients()
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&key);
                return Err(HostRequestError::IdentityChanged);
            }
            return Err(if error.is_timeout() {
                HostRequestError::Timeout
            } else {
                HostRequestError::Unreachable
            });
        }
    };

    // First contact: remember the certificate this Host presented.
    if pinned.verifier.expected.is_none() {
        let seen = *pinned
            .verifier
            .seen
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(seen) = seen {
            let mut pins = read_pins(dir);
            pins.insert(key.clone(), hex::encode(seen));
            write_pins(dir, &pins).map_err(|error| {
                HostRequestError::Invalid(format!("The Host could not be trusted: {error}"))
            })?;
            let mut cache = clients().lock().unwrap_or_else(|error| error.into_inner());
            cache.insert(key.clone(), Arc::new(build_client(Some(seen))?));
        }
    }

    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_owned())))
        .collect();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(HostRequestError::Invalid(
            "The Host sent more data than Cinder accepts.".into(),
        ));
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                    return Err(HostRequestError::Invalid(
                        "The Host sent more data than Cinder accepts.".into(),
                    ));
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(error) if error.is_timeout() => return Err(HostRequestError::Timeout),
            Err(_) => return Err(HostRequestError::Unreachable),
        }
    }
    Ok(HostResponse {
        status,
        headers,
        body,
    })
}

/// The Host address a person has just entered in School connection. It may be
/// contacted before it is saved, so the connection can be tested first.
#[derive(Default)]
pub struct PendingHost(Mutex<Option<String>>);

impl PendingHost {
    pub fn set(&self, base_url: &str) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) = Some(base_url.to_owned());
    }

    /// The saved Host plus the one being set up, for [`send`].
    pub fn allowed(&self, saved: Option<String>) -> Vec<String> {
        let pending = self
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        saved.into_iter().chain(pending).collect()
    }
}

/// Unpacks a request from the webview, framed like a response.
pub fn unframe_request(mut raw: Vec<u8>) -> Result<(RequestMeta, Vec<u8>), HostRequestError> {
    let malformed = || HostRequestError::Invalid("The request could not be read.".into());
    let head_len = raw
        .get(..4)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_be_bytes)
        .ok_or_else(malformed)? as usize;
    let head_end = 4usize.checked_add(head_len).ok_or_else(malformed)?;
    let meta = serde_json::from_slice(raw.get(4..head_end).ok_or_else(malformed)?)
        .map_err(|_| malformed())?;
    Ok((meta, raw.split_off(head_end)))
}

/// Packs a response for the webview: a 4-byte big-endian length, a JSON header
/// with status and headers, then the raw body. Raw bytes avoid encoding a
/// 25 MB download as a JSON number array.
pub fn frame(response: &HostResponse) -> Vec<u8> {
    let head = serde_json::json!({ "status": response.status, "headers": response.headers });
    let head = serde_json::to_vec(&head).unwrap_or_else(|_| b"{}".to_vec());
    let mut framed = Vec::with_capacity(4 + head.len() + response.body.len());
    framed.extend_from_slice(&(head.len() as u32).to_be_bytes());
    framed.extend_from_slice(&head);
    framed.extend_from_slice(&response.body);
    framed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_http_addresses_become_https_on_the_same_port() {
        assert_eq!(
            https_url("http://192.168.1.20:7373").unwrap().as_str(),
            "https://192.168.1.20:7373/"
        );
        assert_eq!(
            https_url("http://cinder.local").unwrap().as_str(),
            "https://cinder.local:80/"
        );
        assert!(https_url("ftp://192.168.1.20").is_err());
        assert!(https_url("https://user:pw@192.168.1.20:7373").is_err());
    }

    #[test]
    fn only_the_saved_host_and_this_computer_are_reachable() {
        let allowed = vec!["http://192.168.1.20:7373".to_owned()];
        let ok = |raw: &str| is_allowed(&https_url(raw).unwrap(), &allowed);
        assert!(ok("https://192.168.1.20:7373/api/health"));
        assert!(ok("http://127.0.0.1:7373/api/health"));
        assert!(ok("http://localhost:9999/"));
        assert!(!ok("https://192.168.1.20:8080/api/health"));
        assert!(!ok("https://192.168.1.21:7373/api/health"));
        assert!(!ok("https://example.com/"));
    }

    #[test]
    fn pins_are_stored_per_host_and_forgotten_on_request() {
        let dir = std::env::temp_dir().join(format!("cinder-pins-{}", uuid::Uuid::new_v4()));
        let mut pins = HashMap::new();
        pins.insert("192.168.1.20:7373".to_owned(), "ab".repeat(32));
        pins.insert("192.168.1.21:7373".to_owned(), "cd".repeat(32));
        write_pins(&dir, &pins).unwrap();
        assert_eq!(
            decode_pin(&read_pins(&dir)["192.168.1.20:7373"]),
            Some([0xab; 32])
        );
        forget(&dir, "http://192.168.1.20:7373").unwrap();
        let left = read_pins(&dir);
        assert!(!left.contains_key("192.168.1.20:7373"));
        assert!(left.contains_key("192.168.1.21:7373"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn framed_requests_unpack_into_details_and_body() {
        let head = br#"{"url":"http://127.0.0.1:7373/api/files","method":"POST","headers":[["content-type","application/pdf"]]}"#;
        let mut raw = (head.len() as u32).to_be_bytes().to_vec();
        raw.extend_from_slice(head);
        raw.extend_from_slice(b"%PDF-1.7");
        let (meta, body) = unframe_request(raw).unwrap();
        assert_eq!(meta.method, "POST");
        assert_eq!(meta.headers[0].1, "application/pdf");
        assert_eq!(body, b"%PDF-1.7");
        assert!(unframe_request(vec![0, 0, 0, 99, b'{']).is_err());
        assert!(unframe_request(vec![1]).is_err());
    }

    #[test]
    fn frames_carry_status_headers_and_raw_body() {
        let framed = frame(&HostResponse {
            status: 201,
            headers: vec![("content-type".into(), "application/json".into())],
            body: b"{\"ok\":true}".to_vec(),
        });
        let head_len = u32::from_be_bytes(framed[..4].try_into().unwrap()) as usize;
        let head: serde_json::Value = serde_json::from_slice(&framed[4..4 + head_len]).unwrap();
        assert_eq!(head["status"], 201);
        assert_eq!(&framed[4 + head_len..], b"{\"ok\":true}");
    }
}
