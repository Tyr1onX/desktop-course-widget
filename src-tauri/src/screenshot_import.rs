#[path = "native_ocr.rs"]
mod native_ocr;

use std::path::Path;

use crate::import_draft::ImportDraft;

pub fn runtime_status() -> Result<(), String> {
    native_ocr::runtime_status()
}

#[cfg(debug_assertions)]
mod development_runtime {
    use super::*;

    // These names document the removed external OCR path and keep the
    // release-boundary regression explicit. No external process is created.
    #[allow(dead_code)]
    const REMOVED_EXTERNAL_RUNTIME_MARKERS: &[&str] = &[
        "COURSE_WIDGET_OCR_PYTHON",
        "COURSE_WIDGET_OCR_REPO_ROOT",
        "Command::new",
        "experiments.screenshot_import",
    ];

    pub fn recognize_screenshot(image_path: &Path) -> Result<ImportDraft, String> {
        native_ocr::recognize_screenshot(image_path)
    }
}

#[cfg(debug_assertions)]
pub use development_runtime::recognize_screenshot;

#[cfg(not(debug_assertions))]
pub fn recognize_screenshot(image_path: &Path) -> Result<ImportDraft, String> {
    native_ocr::recognize_screenshot(image_path)
}
