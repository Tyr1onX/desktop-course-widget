use tauri::{LogicalSize, Manager};

const MAIN_WINDOW_LABEL: &str = "main";
const PRESENTATION_WINDOW_LABEL: &str = "presentation";
const MAIN_WINDOW_WIDTH: f64 = 392.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 160.0;
const MAIN_WINDOW_MAX_HEIGHT: f64 = 740.0;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowMetrics {
    logical_width: f64,
    logical_height: f64,
    physical_width: f64,
    physical_height: f64,
    scale_factor: f64,
}

fn require_window_label(
    window: &tauri::WebviewWindow,
    expected: &str,
) -> Result<(), String> {
    if window.label() == expected {
        Ok(())
    } else {
        Err(format!(
            "window command rejected for caller {}",
            window.label()
        ))
    }
}

#[tauri::command]
pub fn open_presentation_controller(window: tauri::WebviewWindow) -> Result<(), String> {
    require_window_label(&window, MAIN_WINDOW_LABEL)?;
    let controller = window
        .app_handle()
        .get_webview_window(PRESENTATION_WINDOW_LABEL)
        .ok_or_else(|| "presentation controller window is unavailable".to_owned())?;
    controller.show().map_err(|error| error.to_string())?;
    controller.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn configure_main_widget(window: tauri::WebviewWindow) -> Result<(), String> {
    require_window_label(&window, MAIN_WINDOW_LABEL)?;
    window
        .set_min_size(Some(LogicalSize::new(
            MAIN_WINDOW_WIDTH,
            MAIN_WINDOW_MIN_HEIGHT,
        )))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(Some(LogicalSize::new(
            MAIN_WINDOW_WIDTH,
            MAIN_WINDOW_MAX_HEIGHT,
        )))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resize_main_widget(
    window: tauri::WebviewWindow,
    height: f64,
) -> Result<MainWindowMetrics, String> {
    require_window_label(&window, MAIN_WINDOW_LABEL)?;
    if !height.is_finite()
        || !(MAIN_WINDOW_MIN_HEIGHT..=MAIN_WINDOW_MAX_HEIGHT).contains(&height)
    {
        return Err(format!(
            "main window height must be between {MAIN_WINDOW_MIN_HEIGHT} and {MAIN_WINDOW_MAX_HEIGHT}"
        ));
    }

    window
        .set_size(LogicalSize::new(MAIN_WINDOW_WIDTH, height))
        .map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;

    Ok(MainWindowMetrics {
        logical_width: MAIN_WINDOW_WIDTH,
        logical_height: height,
        physical_width: MAIN_WINDOW_WIDTH * scale_factor,
        physical_height: height * scale_factor,
        scale_factor,
    })
}

#[tauri::command]
pub fn show_main_widget(window: tauri::WebviewWindow) -> Result<(), String> {
    require_window_label(&window, MAIN_WINDOW_LABEL)?;
    super::show_main_window(window.app_handle()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_main_widget(window: tauri::WebviewWindow) -> Result<(), String> {
    require_window_label(&window, MAIN_WINDOW_LABEL)?;
    super::hide_main_window(window.app_handle()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_main_widget_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    require_window_label(&window, MAIN_WINDOW_LABEL)?;
    window.start_dragging().map_err(|error| error.to_string())
}
