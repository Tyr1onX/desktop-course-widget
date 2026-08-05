#[path = "native_ocr.rs"]
mod native_ocr;

use std::path::Path;

use crate::import_draft::ImportDraft;

pub fn runtime_status() -> Result<(), String> {
    native_ocr::runtime_status()
}

pub fn recognize_screenshot(image_path: &Path) -> Result<ImportDraft, String> {
    native_ocr::recognize_screenshot(image_path)
}
