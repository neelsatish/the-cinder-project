// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;

use std::time::{Duration, Instant};

use cinder_core::MDNS_SERVICE_TYPE;
use config::StudentConfig;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::Manager;

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
            commands::discover_hosts,
            commands::open_material,
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

    #[tauri::command]
    pub fn load_config(app: tauri::AppHandle) -> Result<StudentConfig, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        Ok(StudentConfig::load(&dir))
    }

    #[tauri::command]
    pub fn save_config(app: tauri::AppHandle, config: StudentConfig) -> Result<(), String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        config.save(&dir).map_err(|error| error.to_string())
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
        let url = format!("{}/api/files/{}", base_url.trim_end_matches('/'), file_id);
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
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
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
        tokio::fs::write(&path, bytes)
            .await
            .map_err(|error| error.to_string())?;

        open_with_system(&path).await
    }
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

async fn open_with_system(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    let mut command = tokio::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = tokio::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = tokio::process::Command::new("open");

    command
        .arg(path)
        .spawn()
        .map_err(|error| format!("The system viewer could not be opened: {error}"))?;
    Ok(())
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
                    let url = format!("http://{}:{}", address, info.get_port());
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
