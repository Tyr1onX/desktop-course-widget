from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


replace_once(
    "src-tauri/src/ocr_component.rs",
    """    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
""",
    """    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
""",
)

replace_once(
    "src-tauri/src/ocr_component.rs",
    "const SUPPORTED_PLATFORM: &str = \"windows-x86_64\";\n",
    """const SUPPORTED_PLATFORM: &str = "windows-x86_64";
static VERIFIED_BUNDLED_COMPONENTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
""",
)

old_status = """    let installed_root = match installed_version_root(app, &manifest.component_version) {
        Ok(path) => path,
        Err(error) => return unavailable_status(error),
    };
    if !installed_root.exists() {
        return OcrComponentStatus {
            state: OcrComponentState::Missing,
            component_version: Some(manifest.component_version),
            source: Some("bundled".into()),
            message: "首次使用需要准备本地识别组件，完成后可离线识别课表截图。".into(),
            can_prepare: true,
        };
    }
    match verify_component_dir(&installed_root, &manifest) {
        Ok(()) => ready_status("installed", Some(manifest.component_version)),
        Err(_) => corrupt_status(
            "installed",
            Some(manifest.component_version),
            "本地识别组件不完整或已损坏，可以重新准备并自动修复。".into(),
            true,
        ),
    }
"""
new_status = """    let installed_root = match installed_version_root(app, &manifest.component_version) {
        Ok(path) => path,
        Err(error) => return unavailable_status(error),
    };
    if installed_root.exists() {
        return match verify_component_dir(&installed_root, &manifest) {
            Ok(()) => ready_status("installed", Some(manifest.component_version)),
            Err(_) => corrupt_status(
                "installed",
                Some(manifest.component_version),
                "本地识别组件不完整或已损坏，可以重新准备并自动修复。".into(),
                true,
            ),
        };
    }

    match verify_bundled_component(&resource_root, &manifest) {
        Ok(()) => ready_status("bundled", Some(manifest.component_version)),
        Err(_) => unavailable_status(
            "安装包内的离线识别组件校验失败，请重新下载安装课刻。".into(),
        ),
    }
"""
replace_once("src-tauri/src/ocr_component.rs", old_status, new_status)

old_resolve = """    let installed_root = installed_version_root(app, &manifest.component_version)?;
    if !installed_root.exists() {
        return Err("本地识别组件尚未准备，请先完成准备".into());
    }
    verify_component_dir(&installed_root, &manifest)
        .map_err(|_| "本地识别组件已损坏，请先重新准备".to_owned())?;
    let runtime = runtime_from_root(&installed_root, &manifest);
    fs::create_dir_all(&runtime.model_cache)
        .map_err(|error| format!("无法准备 OCR 模型目录：{error}"))?;
    Ok(runtime)
"""
new_resolve = """    let installed_root = installed_version_root(app, &manifest.component_version)?;
    if installed_root.exists() {
        verify_component_dir(&installed_root, &manifest)
            .map_err(|_| "本地识别组件已损坏，请先重新准备".to_owned())?;
        return Ok(runtime_from_root(&installed_root, &manifest));
    }

    verify_bundled_component(&resource_root, &manifest)
        .map_err(|_| "安装包内的离线识别组件校验失败，请重新下载安装课刻".to_owned())?;
    Ok(runtime_from_root(&resource_root, &manifest))
"""
replace_once("src-tauri/src/ocr_component.rs", old_resolve, new_resolve)

replace_once(
    "src-tauri/src/ocr_component.rs",
    """fn verify_component_dir(root: &Path, manifest: &OcrComponentManifest) -> Result<(), String> {
""",
    """fn verify_bundled_component(
    root: &Path,
    manifest: &OcrComponentManifest,
) -> Result<(), String> {
    let key = format!("{}|{}", root.to_string_lossy(), manifest.component_version);
    let verified = VERIFIED_BUNDLED_COMPONENTS.get_or_init(|| Mutex::new(HashSet::new()));
    {
        let cache = verified
            .lock()
            .map_err(|_| "无法读取离线识别组件校验缓存".to_owned())?;
        if cache.contains(&key) {
            return Ok(());
        }
    }

    verify_component_dir(root, manifest)?;
    verified
        .lock()
        .map_err(|_| "无法更新离线识别组件校验缓存".to_owned())?
        .insert(key);
    Ok(())
}

fn verify_component_dir(root: &Path, manifest: &OcrComponentManifest) -> Result<(), String> {
""",
)

replace_once(
    "src-tauri/src/screenshot_import.rs",
    """        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
""",
    """        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "1")
""",
)

print("bundled OCR runtime patch applied")
