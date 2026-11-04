mod startup;

#[tauri::command]
fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Full process restart is unavailable in development. Stop the dev process and start it again.".into());
    }

    app.restart();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![startup::finish_startup, restart_app])
        .run(tauri::generate_context!())
        .expect("failed to run ClavierDesk");
}
