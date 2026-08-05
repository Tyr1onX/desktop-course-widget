const APP_COMMANDS: &[&str] = &[
    "read_schedule",
    "read_app_settings",
    "get_runtime_capabilities",
    "open_presentation_controller",
    "configure_main_widget",
    "resize_main_widget",
    "show_main_widget",
    "hide_main_widget",
    "start_main_widget_drag",
    "save_lesson_times",
    "choose_and_parse_excel",
    "choose_and_parse_screenshot",
    "apply_imported_schedule",
];

const SCHEDULE_CATALOG_COMMANDS: &[&str] = &[
    "list_schedules",
    "get_active_schedule",
    "get_schedule",
    "update_schedule",
    "activate_schedule",
    "delete_schedule",
    "create_schedule_from_import",
    "save_course",
    "delete_course",
    "read_autostart",
    "set_autostart",
    "open_data_location",
];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS))
        .plugin(
            "schedule-catalog",
            tauri_build::InlinedPlugin::new().commands(SCHEDULE_CATALOG_COMMANDS),
        );

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
