use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use cinder_core::MDNS_SERVICE_TYPE;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const CONFIG_FILE: &str = "matchbox-config.json";
const SESSION_SECRET: &str = "matchbox-student-session";

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct MatchboxConfig {
    pub host_url: Option<String>,
    pub device_label: Option<String>,
}

fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CONFIG_FILE)
}

fn read_config(data_dir: &Path) -> MatchboxConfig {
    let path = config_path(data_dir);
    std::fs::read_to_string(&path)
        .or_else(|_| std::fs::read_to_string(path.with_extension("json.bak")))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_config(data_dir: &Path, config: &MatchboxConfig) -> anyhow::Result<()> {
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

fn normalize_classroom_url(base_url: &str) -> Result<String, String> {
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
pub fn load_secure_session(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    cinder_core::secure_store::load(&dir, SESSION_SECRET)
        .map_err(|error| error.to_string())?
        .map(String::from_utf8)
        .transpose()
        .map_err(|_| "The saved session is not valid text.".to_owned())
}

#[tauri::command]
pub fn save_secure_session(app: tauri::AppHandle, session: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    cinder_core::secure_store::store(&dir, SESSION_SECRET, session.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_secure_session(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    cinder_core::secure_store::delete(&dir, SESSION_SECRET).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_config(app: tauri::AppHandle) -> Result<MatchboxConfig, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let mut config = read_config(&dir);
    config.host_url = config
        .host_url
        .as_deref()
        .and_then(|address| normalize_classroom_url(address).ok());
    Ok(config)
}

#[tauri::command]
pub fn save_config(app: tauri::AppHandle, mut config: MatchboxConfig) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    config.host_url = config
        .host_url
        .as_deref()
        .map(normalize_classroom_url)
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
    let normalized = normalize_classroom_url(&base_url)?;
    pending.set(&normalized);
    Ok(normalized)
}

/// Sends one classroom request to Cinder Host over pinned HTTPS. The webview
/// frames the request (see `cinder_core::host_client`) and gets a framed
/// response back, so large uploads and downloads stay raw bytes.
#[tauri::command]
pub async fn host_request(
    app: tauri::AppHandle,
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

#[tauri::command]
pub async fn open_material(
    app: tauri::AppHandle,
    pending: tauri::State<'_, cinder_core::host_client::PendingHost>,
    base_url: String,
    token: String,
    file_id: String,
    file_name: String,
) -> Result<(), String> {
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The saved session token is invalid. Sign in again.".into());
    }

    let url = material_url(&base_url, &file_id)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let allowed = pending.allowed(read_config(&dir).host_url);
    let response = cinder_core::host_client::send(
        &dir,
        &allowed,
        cinder_core::host_client::RequestMeta {
            url: url.to_string(),
            method: "GET".into(),
            headers: vec![("authorization".into(), format!("Bearer {token}"))],
            timeout_ms: Some(120_000),
        },
        Vec::new(),
    )
    .await
    .map_err(|error| error.to_string())?;
    if !(200..300).contains(&response.status) {
        return Err(format!(
            "The material could not be downloaded ({})",
            response.status
        ));
    }
    if response.body.len() > cinder_core::MAX_UPLOAD_BYTES {
        return Err("The material is larger than Cinder's download limit.".into());
    }
    let header = |name: &str| {
        response
            .headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    };
    let content_type = header("content-type").unwrap_or_default().to_owned();
    let header_name = header("content-disposition")
        .and_then(file_name_from_disposition)
        .map(str::to_owned);

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("materials");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|error| error.to_string())?;

    let chosen_name = header_name.unwrap_or_else(|| {
        let extension = match content_type.as_str() {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            _ => "bin",
        };
        format!("{file_name}.{extension}")
    });
    let safe_name = sanitize_file_name(&chosen_name);
    let path = cache_dir.join(format!("{file_id}-{safe_name}"));
    let temporary = cache_dir.join(format!(".{file_id}-{}.download", uuid::Uuid::new_v4()));
    if let Err(error) = tokio::fs::write(&temporary, &response.body).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error.to_string());
    }
    let _ = tokio::fs::remove_file(&path).await;
    if let Err(error) = tokio::fs::rename(&temporary, &path).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error.to_string());
    }

    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("The system viewer could not be opened: {error}"))
}

fn material_url(base_url: &str, file_id: &str) -> Result<reqwest::Url, String> {
    let id = file_id
        .parse::<uuid::Uuid>()
        .map_err(|_| "The material identifier is invalid.".to_owned())?;
    let normalized = normalize_classroom_url(base_url)?;
    let mut base =
        reqwest::Url::parse(&normalized).map_err(|_| "The Host address is invalid.".to_owned())?;
    base.set_path(&format!("/api/files/{id}"));
    base.set_query(None);
    base.set_fragment(None);
    Ok(base)
}

fn file_name_from_disposition(value: &str) -> Option<&str> {
    value
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("filename="))
        .map(|name| name.trim_matches('"'))
        .filter(|name| !name.is_empty())
}

fn sanitize_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ')
        })
        .take(120)
        .collect();
    if cleaned.trim().is_empty() {
        "material.bin".to_owned()
    } else {
        cleaned
    }
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

    const FILE_ID: &str = "d9428888-122b-11e1-b85c-61cd3cbb3210";

    #[test]
    fn classroom_addresses_are_limited_and_normalized() {
        assert_eq!(
            normalize_classroom_url(" http://192.168.1.20:7373/ ").unwrap(),
            "http://192.168.1.20:7373"
        );
        assert_eq!(
            normalize_classroom_url("https://school.example/ ").unwrap(),
            "https://school.example"
        );
        assert!(normalize_classroom_url("http://example.com:7373").is_err());
        assert!(normalize_classroom_url("http://192.168.1.20:7373/secret").is_err());
        assert!(normalize_classroom_url("https://user@school.example").is_err());
        assert!(normalize_classroom_url("https://school.example?class=1").is_err());
    }

    #[test]
    fn material_paths_stay_on_the_classroom_host_and_in_the_cache() {
        for base in [
            "http://127.0.0.1:7373",
            "http://192.168.1.20:7373",
            "http://teacher.local:7373",
            "http://[::1]:7373",
            "https://school.example",
        ] {
            let url = material_url(base, FILE_ID).unwrap();
            assert_eq!(url.path(), format!("/api/files/{FILE_ID}"));
        }

        assert!(material_url("http://example.com:7373", FILE_ID).is_err());
        assert!(material_url("file:///tmp/materials", FILE_ID).is_err());
        assert!(material_url("http://127.0.0.1:7373", "../secret").is_err());
        assert_eq!(sanitize_file_name("../../marks.pdf"), "....marks.pdf");
        assert_eq!(sanitize_file_name("<>:\\|?*"), "material.bin");
    }
}
