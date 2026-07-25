fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "schedule-catalog",
            tauri_build::InlinedPlugin::new().commands(&[
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
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
