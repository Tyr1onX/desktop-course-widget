use std::path::Path;

use tauri::AppHandle;

use crate::{import_draft::ImportDraft, native_ocr};

pub fn recognize_screenshot(app: &AppHandle, image_path: &Path) -> Result<ImportDraft, String> {
    native_ocr::recognize_screenshot(app, image_path)
}
