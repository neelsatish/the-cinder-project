// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;

use std::time::{Duration, Instant};

use config::StudentConfig;
use lumina_core::MDNS_SERVICE_TYPE;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use tauri::Manager;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,lumina_student=debug".into()),
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
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::save_config,
            commands::discover_hosts,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(StudentConfig::load(&data_dir));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lumina Student");
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
