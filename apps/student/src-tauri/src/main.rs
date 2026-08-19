// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;

use std::time::{Duration, Instant};

use cinder_core::{DEFAULT_HOST_PORT, MDNS_SERVICE_TYPE};
use config::StudentConfig;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,cinder_student=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::validate_host_address,
            commands::discover_hosts,
            commands::open_material,
            commands::load_secure_session,
            commands::save_secure_session,
            commands::clear_secure_session,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            cinder_core::migrate_legacy_app_data(&data_dir, "student")?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(StudentConfig::load(&data_dir));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Cinder Student");
}

mod commands {
    use super::*;

    const SESSION_SECRET: &str = "student-session";

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
    pub fn load_config(app: tauri::AppHandle) -> Result<StudentConfig, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let mut config = StudentConfig::load(&dir);
        config.host_url = config
            .host_url
            .as_deref()
            .and_then(|address| normalize_classroom_url(address).ok());
        Ok(config)
    }

    #[tauri::command]
    pub fn save_config(app: tauri::AppHandle, mut config: StudentConfig) -> Result<(), String> {
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
        config.save(&dir).map_err(|error| error.to_string())
    }

    #[tauri::command]
    pub fn validate_host_address(base_url: String) -> Result<String, String> {
        normalize_classroom_url(&base_url)
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
        base_url: String,
        token: String,
        file_id: String,
        file_name: String,
    ) -> Result<(), String> {
        if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("The saved session token is invalid. Sign in again.".into());
        }
        let url = material_url(&base_url, &file_id)?;
        let response = reqwest::Client::new()
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| format!("The teacher computer could not be reached: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "The material could not be downloaded ({})",
                response.status()
            ));
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let header_name = response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .and_then(file_name_from_disposition)
            .map(str::to_owned);
        if response
            .content_length()
            .is_some_and(|size| size > cinder_core::MAX_UPLOAD_BYTES as u64)
        {
            return Err("The material is larger than Cinder's download limit.".into());
        }
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
        let mut file = tokio::fs::File::create(&temporary)
            .await
            .map_err(|error| error.to_string())?;
        use tokio::io::AsyncWriteExt;
        let mut response = response;
        let mut received = 0usize;
        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(error) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&temporary).await;
                    return Err(format!("The material download was interrupted: {error}"));
                }
            };
            received = received.saturating_add(chunk.len());
            if received > cinder_core::MAX_UPLOAD_BYTES {
                drop(file);
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err("The material is larger than Cinder's download limit.".into());
            }
            if let Err(error) = file.write_all(&chunk).await {
                drop(file);
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err(error.to_string());
            }
        }
        if let Err(error) = file.flush().await {
            drop(file);
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error.to_string());
        }
        drop(file);
        let _ = tokio::fs::remove_file(&path).await;
        if let Err(error) = tokio::fs::rename(&temporary, &path).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error.to_string());
        }

        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|error| format!("The system viewer could not be opened: {error}"))
    }
}

fn material_url(base_url: &str, file_id: &str) -> Result<reqwest::Url, String> {
    let id = file_id
        .parse::<uuid::Uuid>()
        .map_err(|_| "The material identifier is invalid.".to_owned())?;
    let normalized = normalize_classroom_url(base_url)?;
    let mut base = reqwest::Url::parse(&normalized)
        .map_err(|_| "The teacher address is invalid.".to_owned())?;
    base.set_path(&format!("/api/files/{id}"));
    base.set_query(None);
    base.set_fragment(None);
    Ok(base)
}

fn normalize_classroom_url(base_url: &str) -> Result<String, String> {
    let mut base = reqwest::Url::parse(base_url.trim())
        .map_err(|_| "Enter a valid Cinder Teacher address.".to_owned())?;
    if !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("The teacher address cannot contain credentials or parameters.".into());
    }
    let host = base
        .host_str()
        .ok_or_else(|| "The teacher address has no host.".to_owned())?;
    if !matches!(base.scheme(), "http" | "https") || !cinder_core::is_local_network_host(host) {
        return Err("Cinder only connects to a teacher on the local classroom network.".into());
    }
    if base.port_or_known_default() != Some(DEFAULT_HOST_PORT) {
        return Err(format!(
            "The Cinder Teacher address must use port {DEFAULT_HOST_PORT}."
        ));
    }
    if !matches!(base.path(), "" | "/") {
        return Err("The teacher address cannot contain an extra path.".into());
    }
    base.set_path("");
    Ok(base.to_string().trim_end_matches('/').to_owned())
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
    fn materials_only_open_from_classroom_hosts() {
        for base in [
            "http://127.0.0.1:7373",
            "http://192.168.1.20:7373",
            "http://teacher.local:7373",
            "http://[::1]:7373",
        ] {
            let url = material_url(base, FILE_ID).unwrap();
            assert_eq!(url.path(), format!("/api/files/{FILE_ID}"));
        }

        assert!(material_url("http://example.com:7373", FILE_ID).is_err());
        assert!(material_url("file:///tmp/materials", FILE_ID).is_err());
        assert!(material_url("http://127.0.0.1:7373", "../secret").is_err());
    }

    #[test]
    fn classroom_addresses_are_normalized_before_use() {
        assert_eq!(
            normalize_classroom_url(" http://192.168.1.20:7373/ ").unwrap(),
            "http://192.168.1.20:7373"
        );
        assert!(normalize_classroom_url("http://example.com:7373").is_err());
        assert!(normalize_classroom_url("http://192.168.1.20:8000").is_err());
        assert!(normalize_classroom_url("http://192.168.1.20:7373/redirect").is_err());
    }

    #[test]
    fn downloaded_names_cannot_escape_the_cache() {
        assert_eq!(sanitize_file_name("../../marks.pdf"), "....marks.pdf");
        assert_eq!(sanitize_file_name("<>:\\|?*"), "material.bin");
    }
}
