use tauri::Manager;

/// Only the editor window may finish startup. Show it before removing the splash.
#[tauri::command]
pub fn finish_startup(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the editor can finish startup".into());
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if let Some(splash) = window.app_handle().get_webview_window("splashscreen") {
        splash.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}
