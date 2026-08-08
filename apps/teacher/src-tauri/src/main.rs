// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::SocketAddr;

use lumina_ai::Ai;
use lumina_core::DEFAULT_HOST_PORT;
use lumina_host::{discovery, AppState};
use tauri::Manager;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,lumina_host=debug".into()),
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
        .invoke_handler(tauri::generate_handler![host_info])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            start_host(&data_dir)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lumina Teacher");
}

fn start_host(data_dir: &std::path::Path) -> anyhow::Result<()> {
    let state = AppState::open(data_dir, Ai::disabled())?;
    let address = SocketAddr::from(([0, 0, 0, 0], DEFAULT_HOST_PORT));
    let listener = lumina_host::bind(address)?;
    tauri::async_runtime::spawn(async move {
        if let Err(error) = lumina_host::serve_on(state, listener).await {
            tracing::error!(?error, "Lumina host stopped");
        }
    });

    match discovery::advertise(DEFAULT_HOST_PORT, "Lumina Teacher") {
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
