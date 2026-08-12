// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::SocketAddr;

use cinder_ai::Ai;
use cinder_core::DEFAULT_HOST_PORT;
use cinder_host::{discovery, AppState};
use tauri::Manager;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,cinder_host=debug".into()),
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
            host_info,
            write_text_export,
            write_binary_export,
            load_secure_session,
            save_secure_session,
            clear_secure_session,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            cinder_core::migrate_legacy_app_data(&data_dir, "teacher")?;
            std::fs::create_dir_all(&data_dir)?;
            start_host(&data_dir)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Cinder Teacher");
}

fn start_host(data_dir: &std::path::Path) -> anyhow::Result<()> {
    let state = AppState::open(data_dir, Ai::disabled())?;
    let address = SocketAddr::from(([0, 0, 0, 0], DEFAULT_HOST_PORT));
    let listener = cinder_host::bind(address)?;
    tauri::async_runtime::spawn(async move {
        if let Err(error) = cinder_host::serve_on(state, listener).await {
            tracing::error!(?error, "Cinder host stopped");
        }
    });

    match discovery::advertise(DEFAULT_HOST_PORT, "Cinder Teacher") {
        Ok(daemon) => std::mem::forget(daemon),
        Err(error) => tracing::warn!(?error, "mDNS unavailable; manual address still works"),
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct HostInfo {
    base_url: String,
    port: u16,
}

#[tauri::command]
fn host_info() -> HostInfo {
    HostInfo {
        base_url: format!("http://127.0.0.1:{DEFAULT_HOST_PORT}"),
        port: DEFAULT_HOST_PORT,
    }
}

#[tauri::command]
fn write_text_export(path: String, contents: String) -> Result<(), String> {
    const MAX_EXPORT_BYTES: usize = 10 * 1024 * 1024;
    if contents.len() > MAX_EXPORT_BYTES {
        return Err("The export is larger than 10 MB.".into());
    }
    let path = std::path::PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Choose a filename ending in .csv, .html, .doc, or .txt.".to_owned())?;
    if !matches!(extension.as_str(), "csv" | "html" | "doc" | "txt") {
        return Err("Cinder can only write CSV, HTML, DOC, or TXT exports.".into());
    }
    std::fs::write(&path, contents).map_err(|error| format!("Could not save the export: {error}"))
}

#[tauri::command]
fn write_binary_export(path: String, contents: Vec<u8>) -> Result<(), String> {
    const MAX_EXPORT_BYTES: usize = 20 * 1024 * 1024;
    if contents.len() > MAX_EXPORT_BYTES {
        return Err("The PDF export is larger than 20 MB.".into());
    }
    if contents.len() < 5 || !contents.starts_with(b"%PDF-") {
        return Err("Cinder refused to write an invalid PDF export.".into());
    }
    let path = std::path::PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Choose a filename ending in .pdf.".to_owned())?;
    if extension != "pdf" {
        return Err("Cinder can only write PDF files through this export.".into());
    }
    std::fs::write(&path, contents).map_err(|error| format!("Could not save the PDF: {error}"))
}

const SESSION_SECRET: &str = "teacher-session";

#[tauri::command]
fn load_secure_session(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    cinder_core::secure_store::load(&data_dir, SESSION_SECRET)
        .map_err(|error| error.to_string())?
        .map(String::from_utf8)
        .transpose()
        .map_err(|_| "The saved session is not valid text.".to_owned())
}

#[tauri::command]
fn save_secure_session(app: tauri::AppHandle, session: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    cinder_core::secure_store::store(&data_dir, SESSION_SECRET, session.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_secure_session(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    cinder_core::secure_store::delete(&data_dir, SESSION_SECRET).map_err(|error| error.to_string())
}
