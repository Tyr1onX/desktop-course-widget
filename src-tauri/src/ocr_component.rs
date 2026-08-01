use std::{
    collections::HashSet,
    env, fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const OCR_PYTHON_ENV: &str = "COURSE_WIDGET_OCR_PYTHON";
const OCR_REPO_ROOT_ENV: &str = "COURSE_WIDGET_OCR_REPO_ROOT";
const COMPONENT_RESOURCE_DIR: &str = "ocr-component";
const COMPONENT_MANIFEST_FILE: &str = "component.json";
const COMPONENT_STORAGE_DIR: &str = "ocr-component";
const COMPONENT_SCHEMA_VERSION: u8 = 1;
const SUPPORTED_PLATFORM: &str = "windows-x86_64";

#[derive(Debug, Clone)]
pub struct RecognizerRuntime {
    pub python: PathBuf,
    pub module_root: PathBuf,
    pub model_cache: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrComponentStatus {
    pub state: OcrComponentState,
    pub component_version: Option<String>,
    pub source: Option<String>,
    pub message: String,
    pub can_prepare: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OcrComponentState {
    Ready,
    Missing,
    Corrupt,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OcrComponentManifest {
    schema_version: u8,
    #[serde(default)]
    available: bool,
    component_version: String,
    platform: String,
    python_relative_path: String,
    module_root_relative_path: String,
    model_cache_relative_path: String,
    #[serde(default)]
    files: Vec<OcrComponentFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OcrComponentFile {
    path: String,
    size: u64,
    sha256: String,
}

pub fn read_status(app: &AppHandle) -> OcrComponentStatus {
    match resolve_configured_runtime() {
        Ok(Some(runtime)) => {
            return ready_status("configured", None, runtime);
        }
        Err(error) => {
            return OcrComponentStatus {
                state: OcrComponentState::Corrupt,
                component_version: None,
                source: Some("configured".into()),
                message: error,
                can_prepare: false,
            };
        }
        Ok(None) => {}
    }

    if cfg!(debug_assertions) {
        match resolve_development_runtime() {
            Ok(runtime) => return ready_status("development", None, runtime),
            Err(error) => {
                return OcrComponentStatus {
                    state: OcrComponentState::Missing,
                    component_version: None,
                    source: Some("development".into()),
                    message: error,
                    can_prepare: false,
                };
            }
        }
    }

    let resource_root = match resource_root(app) {
        Ok(path) => path,
        Err(error) => return unavailable_status(error),
    };
    let manifest = match read_manifest(&resource_root.join(COMPONENT_MANIFEST_FILE)) {
        Ok(manifest) => manifest,
        Err(error) => return unavailable_status(error),
    };
    if let Err(error) = validate_manifest(&manifest) {
        return unavailable_status(error);
    }
    if !manifest.available {
        return unavailable_status(
            "当前安装包尚未包含离线识别组件，请安装后续支持截图识别的版本。".into(),
        );
    }

    let installed_root = match installed_version_root(app, &manifest.component_version) {
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
        Ok(()) => ready_status(
            "installed",
            Some(manifest.component_version),
            runtime_from_root(&installed_root, &manifest),
        ),
        Err(_) => OcrComponentStatus {
            state: OcrComponentState::Corrupt,
            component_version: Some(manifest.component_version),
            source: Some("installed".into()),
            message: "本地识别组件不完整或已损坏，可以重新准备并自动修复。".into(),
            can_prepare: true,
        },
    }
}

pub fn prepare(app: &AppHandle) -> Result<OcrComponentStatus, String> {
    if resolve_configured_runtime()?.is_some() {
        return Ok(read_status(app));
    }
    if cfg!(debug_assertions) && resolve_development_runtime().is_ok() {
        return Ok(read_status(app));
    }

    let resource_root = resource_root(app)?;
    let manifest = read_manifest(&resource_root.join(COMPONENT_MANIFEST_FILE))?;
    validate_manifest(&manifest)?;
    if !manifest.available {
        return Err("当前安装包尚未包含可准备的离线识别组件".into());
    }
    verify_component_dir(&resource_root, &manifest)
        .map_err(|_| "安装包内的识别组件校验失败，请重新下载安装课刻".to_owned())?;

    let storage_root = component_storage_root(app)?;
    let versions_root = storage_root.join("versions");
    fs::create_dir_all(&versions_root)
        .map_err(|error| format!("无法创建本地识别组件目录：{error}"))?;
    let destination = versions_root.join(&manifest.component_version);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法准备本地识别组件：{error}"))?
        .as_nanos();
    let staging = versions_root.join(format!(".staging-{}-{nonce}", std::process::id()));

    let install_result = install_from_resource(&resource_root, &staging, &manifest);
    if let Err(error) = install_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if destination.exists() {
        fs::remove_dir_all(&destination)
            .map_err(|error| format!("无法替换损坏的本地识别组件：{error}"))?;
    }
    fs::rename(&staging, &destination)
        .map_err(|error| format!("无法启用本地识别组件：{error}"))?;
    cleanup_other_versions(&versions_root, &manifest.component_version);

    let status = read_status(app);
    if status.state != OcrComponentState::Ready {
        return Err("本地识别组件准备完成后校验未通过".into());
    }
    Ok(status)
}

pub fn resolve_runtime(app: &AppHandle) -> Result<RecognizerRuntime, String> {
    if let Some(runtime) = resolve_configured_runtime()? {
        return Ok(runtime);
    }
    if cfg!(debug_assertions) {
        return resolve_development_runtime();
    }

    let resource_root = resource_root(app)?;
    let manifest = read_manifest(&resource_root.join(COMPONENT_MANIFEST_FILE))?;
    validate_manifest(&manifest)?;
    if !manifest.available {
        return Err("当前安装包尚未包含离线识别组件".into());
    }
    let installed_root = installed_version_root(app, &manifest.component_version)?;
    if !installed_root.exists() {
        return Err("本地识别组件尚未准备，请先完成准备".into());
    }
    verify_component_dir(&installed_root, &manifest)
        .map_err(|_| "本地识别组件已损坏，请先重新准备".to_owned())?;
    Ok(runtime_from_root(&installed_root, &manifest))
}

fn ready_status(
    source: &str,
    component_version: Option<String>,
    runtime: RecognizerRuntime,
) -> OcrComponentStatus {
    let _ = runtime;
    OcrComponentStatus {
        state: OcrComponentState::Ready,
        component_version,
        source: Some(source.into()),
        message: "本地识别组件已就绪，课表图片不会上传。".into(),
        can_prepare: false,
    }
}

fn unavailable_status(message: String) -> OcrComponentStatus {
    OcrComponentStatus {
        state: OcrComponentState::Unavailable,
        component_version: None,
        source: Some("bundled".into()),
        message,
        can_prepare: false,
    }
}

fn resolve_configured_runtime() -> Result<Option<RecognizerRuntime>, String> {
    let configured_python = env::var_os(OCR_PYTHON_ENV).map(PathBuf::from);
    let configured_root = env::var_os(OCR_REPO_ROOT_ENV).map(PathBuf::from);
    match (configured_python, configured_root) {
        (None, None) => Ok(None),
        (Some(python), Some(module_root)) => {
            validate_runtime_paths(&python, &module_root)?;
            Ok(Some(RecognizerRuntime {
                python,
                model_cache: module_root.join(".tmp/screenshot-ocr-models"),
                module_root,
            }))
        }
        _ => Err(format!(
            "开发态截图识别需要同时设置 {OCR_PYTHON_ENV} 与 {OCR_REPO_ROOT_ENV}"
        )),
    }
}

fn resolve_development_runtime() -> Result<RecognizerRuntime, String> {
    let module_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "无法定位截图识别开发仓库".to_owned())?
        .to_path_buf();
    let candidates = [
        module_root.join(".tmp/screenshot-ocr-venv/Scripts/python.exe"),
        module_root.join(".tmp/screenshot-ocr-venv/bin/python"),
        module_root.join(".venv/Scripts/python.exe"),
        module_root.join(".venv/bin/python"),
    ];
    let python = candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "未找到仓库内 OCR 开发运行时。请先准备 .tmp/screenshot-ocr-venv，不能依赖系统 Python。"
                .to_owned()
        })?;
    validate_runtime_paths(&python, &module_root)?;
    Ok(RecognizerRuntime {
        python,
        model_cache: module_root.join(".tmp/screenshot-ocr-models"),
        module_root,
    })
}

fn validate_runtime_paths(python: &Path, module_root: &Path) -> Result<(), String> {
    if !python.is_file() {
        return Err("配置的 OCR Python 不存在".into());
    }
    if !module_root.join("experiments/screenshot_import").is_dir() {
        return Err("配置的 OCR 模块目录无效".into());
    }
    Ok(())
}

fn runtime_from_root(root: &Path, manifest: &OcrComponentManifest) -> RecognizerRuntime {
    RecognizerRuntime {
        python: root.join(&manifest.python_relative_path),
        module_root: root.join(&manifest.module_root_relative_path),
        model_cache: root.join(&manifest.model_cache_relative_path),
    }
}

fn resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位安装包资源目录：{error}"))?
        .join(COMPONENT_RESOURCE_DIR))
}

fn component_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join(COMPONENT_STORAGE_DIR))
}

fn installed_version_root(app: &AppHandle, version: &str) -> Result<PathBuf, String> {
    Ok(component_storage_root(app)?.join("versions").join(version))
}

fn read_manifest(path: &Path) -> Result<OcrComponentManifest, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("无法读取本地识别组件清单：{error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("本地识别组件清单格式无效：{error}"))
}

fn validate_manifest(manifest: &OcrComponentManifest) -> Result<(), String> {
    if manifest.schema_version != COMPONENT_SCHEMA_VERSION {
        return Err("本地识别组件清单版本不受支持".into());
    }
    if manifest.component_version.trim().is_empty()
        || manifest.component_version.contains(['/', '\\'])
        || manifest.component_version == "."
        || manifest.component_version == ".."
    {
        return Err("本地识别组件版本号无效".into());
    }
    if manifest.platform != SUPPORTED_PLATFORM {
        return Err("当前安装包中的识别组件不适用于此平台".into());
    }
    validate_relative_path(&manifest.python_relative_path)?;
    validate_relative_path(&manifest.module_root_relative_path)?;
    validate_relative_path(&manifest.model_cache_relative_path)?;
    if !manifest.available {
        return Ok(());
    }
    if manifest.files.is_empty() {
        return Err("本地识别组件清单没有包含任何文件".into());
    }

    let mut seen = HashSet::new();
    for file in &manifest.files {
        validate_relative_path(&file.path)?;
        if file.size == 0 {
            return Err(format!("本地识别组件文件大小无效：{}", file.path));
        }
        if file.sha256.len() != 64
            || !file
                .sha256
                .bytes()
                .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
        {
            return Err(format!("本地识别组件文件哈希无效：{}", file.path));
        }
        if !seen.insert(file.path.clone()) {
            return Err(format!("本地识别组件清单包含重复路径：{}", file.path));
        }
    }
    if !seen.contains(&manifest.python_relative_path) {
        return Err("本地识别组件清单未包含 Python 入口".into());
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("本地识别组件清单包含空路径".into());
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("本地识别组件路径必须是相对路径：{value}"));
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(format!("本地识别组件路径不安全：{value}"));
        }
    }
    Ok(())
}

fn verify_component_dir(root: &Path, manifest: &OcrComponentManifest) -> Result<(), String> {
    validate_manifest(manifest)?;
    if !manifest.available {
        return Err("本地识别组件不可用".into());
    }
    for expected in &manifest.files {
        let path = root.join(&expected.path);
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("本地识别组件文件缺失：{}：{error}", expected.path))?;
        if !metadata.is_file() || metadata.len() != expected.size {
            return Err(format!("本地识别组件文件大小不匹配：{}", expected.path));
        }
        let actual = sha256_file(&path)?;
        if actual != expected.sha256 {
            return Err(format!("本地识别组件文件校验失败：{}", expected.path));
        }
    }
    let runtime = runtime_from_root(root, manifest);
    validate_runtime_paths(&runtime.python, &runtime.module_root)?;
    fs::create_dir_all(&runtime.model_cache)
        .map_err(|error| format!("无法准备 OCR 模型目录：{error}"))?;
    Ok(())
}

fn install_from_resource(
    resource_root: &Path,
    destination: &Path,
    manifest: &OcrComponentManifest,
) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("无法创建识别组件临时目录：{error}"))?;
    for expected in &manifest.files {
        let source = resource_root.join(&expected.path);
        let target = destination.join(&expected.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建识别组件目录：{error}"))?;
        }
        fs::copy(&source, &target)
            .map_err(|error| format!("无法复制识别组件文件 {}：{error}", expected.path))?;
    }
    let manifest_bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("无法保存识别组件清单：{error}"))?;
    fs::write(destination.join(COMPONENT_MANIFEST_FILE), manifest_bytes)
        .map_err(|error| format!("无法保存识别组件清单：{error}"))?;
    verify_component_dir(destination, manifest)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("无法读取识别组件文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("无法校验识别组件文件：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn cleanup_other_versions(versions_root: &Path, active_version: &str) {
    let Ok(entries) = fs::read_dir(versions_root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == active_version || name.starts_with(".staging-") {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            let _ = fs::remove_dir_all(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_record(path: &str, bytes: &[u8]) -> OcrComponentFile {
        OcrComponentFile {
            path: path.into(),
            size: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(bytes)),
        }
    }

    fn manifest(files: Vec<OcrComponentFile>) -> OcrComponentManifest {
        OcrComponentManifest {
            schema_version: 1,
            available: true,
            component_version: "test-v1".into(),
            platform: SUPPORTED_PLATFORM.into(),
            python_relative_path: "python/python.exe".into(),
            module_root_relative_path: "app".into(),
            model_cache_relative_path: "models".into(),
            files,
        }
    }

    #[test]
    fn rejects_absolute_and_parent_paths() {
        assert!(validate_relative_path("python/python.exe").is_ok());
        assert!(validate_relative_path("../python.exe").is_err());
        assert!(validate_relative_path("C:\\python.exe").is_err());
        assert!(validate_relative_path("python/./python.exe").is_err());
    }

    #[test]
    fn manifest_requires_the_python_entry() {
        let result = validate_manifest(&manifest(vec![file_record("app/module.py", b"test")]));
        assert!(result.is_err());
    }

    #[test]
    fn install_copies_only_manifest_files_and_detects_tampering() {
        let root = env::temp_dir().join(format!(
            "course-widget-ocr-component-test-{}",
            std::process::id()
        ));
        let source = root.join("source");
        let destination = root.join("destination");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(source.join("python")).unwrap();
        fs::create_dir_all(source.join("app/experiments/screenshot_import")).unwrap();
        fs::write(source.join("python/python.exe"), b"python").unwrap();
        fs::write(
            source.join("app/experiments/screenshot_import/__init__.py"),
            b"module",
        )
        .unwrap();
        fs::write(source.join("unlisted.txt"), b"ignore").unwrap();
        let manifest = manifest(vec![
            file_record("python/python.exe", b"python"),
            file_record(
                "app/experiments/screenshot_import/__init__.py",
                b"module",
            ),
        ]);

        install_from_resource(&source, &destination, &manifest).unwrap();
        assert!(!destination.join("unlisted.txt").exists());
        assert!(verify_component_dir(&destination, &manifest).is_ok());
        fs::write(destination.join("python/python.exe"), b"changed").unwrap();
        assert!(verify_component_dir(&destination, &manifest).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
