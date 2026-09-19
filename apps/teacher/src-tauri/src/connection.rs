use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use cinder_core::MDNS_SERVICE_TYPE;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILE: &str = "teacher-config.json";

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct TeacherConfig {
    pub host_url: Option<String>,
    pub device_label: Option<String>,
}

fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CONFIG_FILE)
}

fn read_config(data_dir: &Path) -> TeacherConfig {
    let path = config_path(data_dir);
    std::fs::read_to_string(&path)
        .or_else(|_| std::fs::read_to_string(path.with_extension("json.bak")))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_config(data_dir: &Path, config: &TeacherConfig) -> anyhow::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let path = config_path(data_dir);
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    std::fs::write(&temporary, serde_json::to_vec_pretty(config)?)?;
    let _ = std::fs::remove_file(&backup);
    if path.exists() {
        std::fs::rename(&path, &backup)?;
    }
    if let Err(error) = std::fs::rename(&temporary, &path) {
        let _ = std::fs::rename(&backup, &path);
        return Err(error.into());
    }
    let _ = std::fs::remove_file(backup);
    Ok(())
}

fn normalize_host_url(base_url: &str) -> Result<String, String> {
    let mut base = reqwest::Url::parse(base_url.trim())
        .map_err(|_| "Enter a valid Cinder Host address.".to_owned())?;
    if !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("The Host address cannot contain credentials or parameters.".into());
    }
    let host = base
        .host_str()
        .ok_or_else(|| "The Host address has no host.".to_owned())?;
    if !matches!(base.scheme(), "http" | "https") {
        return Err("The Host address must start with http:// or https://.".into());
    }
    if base.scheme() == "http" && !cinder_core::is_local_network_host(host) {
        return Err("Use HTTPS when connecting outside the local school network.".into());
    }
    if !matches!(base.path(), "" | "/") {
        return Err("The Host address cannot contain an extra path.".into());
    }
    base.set_path("");
    Ok(base.to_string().trim_end_matches('/').to_owned())
}

#[tauri::command]
pub fn load_config(app: tauri::AppHandle) -> Result<TeacherConfig, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let mut config = read_config(&dir);
    config.host_url = config
        .host_url
        .as_deref()
        .and_then(|address| normalize_host_url(address).ok());
    Ok(config)
}

#[tauri::command]
pub fn save_config(app: tauri::AppHandle, mut config: TeacherConfig) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    config.host_url = config
        .host_url
        .as_deref()
        .map(normalize_host_url)
        .transpose()?;
    config.device_label = config
        .device_label
        .map(|label| label.trim().chars().take(80).collect())
        .filter(|label: &String| !label.is_empty());
    write_config(&dir, &config).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn validate_host_address(
    pending: tauri::State<'_, cinder_core::host_client::PendingHost>,
    base_url: String,
) -> Result<String, String> {
    let normalized = normalize_host_url(&base_url)?;
    pending.set(&normalized);
    Ok(normalized)
}

/// Sends one classroom request to Cinder Host over pinned HTTPS. The webview
/// frames the request (see `cinder_core::host_client`) and gets a framed
/// response back, so large uploads and downloads stay raw bytes.
#[tauri::command]
pub async fn host_request<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pending: tauri::State<'_, cinder_core::host_client::PendingHost>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(raw) = request.body() else {
        return Err("invalid: The request could not be read.".into());
    };
    let (meta, body) =
        cinder_core::host_client::unframe_request(raw.clone()).map_err(|e| e.to_string())?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let allowed = pending.allowed(read_config(&dir).host_url);
    let response = cinder_core::host_client::send(&dir, &allowed, meta, body)
        .await
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(cinder_core::host_client::frame(
        &response,
    )))
}

/// Stops trusting the certificate remembered for this Host, so the next
/// connection trusts the one it presents. Called only when a person saves the
/// Host address in School connection.
#[tauri::command]
pub fn forget_host_identity(app: tauri::AppHandle, base_url: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    cinder_core::host_client::forget(&dir, &base_url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn discover_hosts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(discover)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn discover() -> anyhow::Result<Vec<String>> {
    let daemon = ServiceDaemon::new()?;
    let receiver = daemon.browse(MDNS_SERVICE_TYPE)?;
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut hosts = Vec::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                for address in info.get_addresses() {
                    let url = match address {
                        std::net::IpAddr::V4(address) => {
                            format!("http://{}:{}", address, info.get_port())
                        }
                        std::net::IpAddr::V6(address) => {
                            format!("http://[{}]:{}", address, info.get_port())
                        }
                    };
                    if !hosts.contains(&url) {
                        hosts.push(url);
                    }
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.stop_browse(MDNS_SERVICE_TYPE);
    let _ = daemon.shutdown();
    hosts.sort();
    Ok(hosts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_addresses_are_secure_and_normalized() {
        assert_eq!(
            normalize_host_url(" http://192.168.1.20:7373/ ").unwrap(),
            "http://192.168.1.20:7373"
        );
        assert_eq!(
            normalize_host_url("https://school.example.com/").unwrap(),
            "https://school.example.com"
        );
        assert!(normalize_host_url("http://school.example.com:7373").is_err());
        assert!(normalize_host_url("ftp://192.168.1.20:7373").is_err());
        assert!(normalize_host_url("https://school.example.com/cinder").is_err());
        assert!(normalize_host_url("https://user@school.example.com").is_err());
    }
}

#[cfg(test)]
mod ipc_tests {
    use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::Manager;

    /// Frames a request exactly as packages/ui/src/hostTransport.ts does.
    fn framed(url: &str) -> Vec<u8> {
        let head = serde_json::json!({
            "url": url, "method": "GET", "headers": [["accept", "application/json"]],
            "timeoutMs": 5000,
        })
        .to_string();
        let mut raw = (head.len() as u32).to_be_bytes().to_vec();
        raw.extend_from_slice(head.as_bytes());
        raw
    }

    fn invoke(body: Vec<u8>) -> InvokeRequest {
        InvokeRequest {
            cmd: "host_request".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Raw(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        }
    }

    /// Starts a real Cinder Host with TLS on its own runtime; returns its port.
    fn start_host(school: &std::path::Path) -> u16 {
        let state = cinder_host::AppState::open(school, cinder_ai::Ai::disabled()).unwrap();
        let identity = cinder_host::tls::load_or_create_identity(&school.join("tls")).unwrap();
        let listener = cinder_host::bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new()
                .unwrap()
                .block_on(cinder_host::serve_on_with_shutdown(
                    state,
                    listener,
                    identity,
                    std::future::pending(),
                ))
        });
        port
    }

    #[test]
    fn the_webview_reaches_a_real_host_through_ipc_and_pinned_https() {
        let school = tempfile::tempdir().unwrap();
        let port = start_host(school.path());

        let mut context = mock_context(noop_assets());
        // A throwaway identifier: the command writes its pin file under it.
        context.config_mut().identifier = format!("org.cinder.test.{}", uuid::Uuid::new_v4());
        let app = mock_builder()
            .manage(cinder_core::host_client::PendingHost::default())
            .invoke_handler(tauri::generate_handler![super::host_request])
            .build(context)
            .unwrap();
        let data_dir = app.path().app_data_dir().unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        let response = get_ipc_response(
            &webview,
            invoke(framed(&format!("http://127.0.0.1:{port}/api/health"))),
        );
        let InvokeResponseBody::Raw(raw) = response.unwrap() else {
            panic!("the response must be raw bytes, not JSON");
        };
        let head_len = u32::from_be_bytes(raw[..4].try_into().unwrap()) as usize;
        let head: serde_json::Value = serde_json::from_slice(&raw[4..4 + head_len]).unwrap();
        let body: serde_json::Value = serde_json::from_slice(&raw[4 + head_len..]).unwrap();
        assert_eq!(head["status"], 200);
        assert_eq!(body["ok"], true);
        assert!(
            data_dir.join("trusted-hosts.json").exists(),
            "first contact pins"
        );

        // Only the saved Host, one being set up, or this computer is reachable.
        let refused =
            get_ipc_response(&webview, invoke(framed("http://192.0.2.1:7373/api/health")));
        assert!(refused
            .unwrap_err()
            .as_str()
            .is_some_and(|error| error.starts_with("invalid:")));
        let garbled = get_ipc_response(&webview, invoke(vec![0, 0, 0, 9, b'{']));
        assert!(garbled.is_err());

        let _ = std::fs::remove_dir_all(data_dir);
    }
}
