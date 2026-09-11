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
pub fn validate_host_address(base_url: String) -> Result<String, String> {
    normalize_host_url(&base_url)
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
