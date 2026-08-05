#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub platform: String,
    pub screenshot_import: ScreenshotImportCapability,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotImportCapability {
    pub available: bool,
    pub backend: String,
    pub unavailable_reason: Option<String>,
}

pub fn current() -> RuntimeCapabilities {
    RuntimeCapabilities {
        platform: std::env::consts::OS.to_owned(),
        screenshot_import: screenshot_import_capability(),
    }
}

#[cfg(debug_assertions)]
fn screenshot_import_capability() -> ScreenshotImportCapability {
    match crate::screenshot_import::development_runtime_status() {
        Ok(()) => ScreenshotImportCapability {
            available: true,
            backend: "python-development".into(),
            unavailable_reason: None,
        },
        Err(reason) => ScreenshotImportCapability {
            available: false,
            backend: "python-development".into(),
            unavailable_reason: Some(reason),
        },
    }
}

#[cfg(not(debug_assertions))]
fn screenshot_import_capability() -> ScreenshotImportCapability {
    ScreenshotImportCapability {
        available: false,
        backend: "none".into(),
        unavailable_reason: Some(crate::screenshot_import::RELEASE_UNAVAILABLE_REASON.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_is_reported() {
        assert_eq!(current().platform, std::env::consts::OS);
    }

    #[test]
    fn unavailable_capability_has_a_reason() {
        let capability = screenshot_import_capability();
        if !capability.available {
            assert!(capability.unavailable_reason.is_some());
        }
    }
}
