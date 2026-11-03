mod startup;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![startup::finish_startup])
        .run(tauri::generate_context!())
        .expect("failed to run ClavierDesk");
}
