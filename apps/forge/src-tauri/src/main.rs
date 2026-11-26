// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod matchbox;

use tauri::Manager;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    tauri::Builder::default()
        // A second copy would share the saved sign-in and the offline queue with the first, so
        // signing out in one signed the other out later. Opening it again shows the open window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            matchbox::load_config,
            matchbox::save_config,
            matchbox::validate_host_address,
            matchbox::host_request,
            matchbox::forget_host_identity,
            matchbox::inspect_host_identity,
            matchbox::trust_host_identity,
            matchbox::discover_hosts,
            matchbox::load_secure_session,
            matchbox::save_secure_session,
            matchbox::clear_secure_session,
            matchbox::open_material,
        ])
        .manage(cinder_core::host_client::PendingHost::default())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Cinder Student");
}
