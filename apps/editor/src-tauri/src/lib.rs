mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::ProjectState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::close_project,
            commands::reload_project,
            commands::check_project_changes,
            commands::save_project,
            commands::write_project_build,
            commands::open_project_output,
        ])
        .run(tauri::generate_context!())
        .expect("Creator Studio could not start");
}
