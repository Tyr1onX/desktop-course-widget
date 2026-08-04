// Prevents an additional console window in Windows release builds.
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    desktop_course_widget_lib::run();
}
