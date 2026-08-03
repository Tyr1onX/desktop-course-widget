use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env,
    ffi::{OsStr, OsString},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::{
    ffi::{OsStrExt, OsStringExt},
    process::CommandExt,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::ocr_diagnostics::{self, DiagnosticEvidence};

const OCR_PYTHON_ENV: &str = "COURSE_WIDGET_OCR_PYTHON";
const OCR_REPO_ROOT_ENV: &str = "COURSE_WIDGET_OCR_REPO_ROOT";
const OCR_RESOURCE_ROOT_ENV: &str = "COURSE_WIDGET_OCR_COMPONENT_RESOURCE_ROOT";
const OCR_STORAGE_ROOT_ENV: &str = "COURSE_WIDGET_OCR_COMPONENT_STORAGE_ROOT";
const COMPONENT_RESOURCE_DIR: &str = "ocr-component";
const COMPONENT_STORAGE_DIR: &str = "ocr-component";
const COMPONENT_MANIFEST_FILE: &str = "component.json";
const COMPONENT_SCHEMA_VERSION: u8 = 1;
const SUPPORTED_PLATFORM: &str = "windows-x86_64";
const QUICK_PROBE_TIMEOUT: Duration = Duration::from_secs(45);
const INITIALIZATION_PROBE_TIMEOUT: Duration = Duration::from_secs(4 * 60);
const PYTHON_BOOTSTRAP: &str =
    "import runpy,sys;root=sys.argv.pop(1);module=sys.argv.pop(1);sys.path.insert(0,root);runpy.run_module(module,run_name='__main__')";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const ASCII_MODEL_CACHE_DIR: &str = "CourseWidgetOcrRuntime";

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetShortPathNameW(long_path: *const u16, short_path: *mut u16, buffer_length: u32) -> u32;
}

static VERIFIED_BUNDLED_COMPONENTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static VERIFIED_ASCII_MODEL_CACHES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static QUICK_PROBE_SUCCESSES: OnceLock<Mutex<HashMap<String, OcrProbeReport>>> = OnceLock::new();
static INITIALIZATION_PROBE_SUCCESSES: OnceLock<Mutex<HashMap<String, OcrProbeReport>>> =
    OnceLock::new();

#[derive(Debug, Clone)]
struct RuntimeModelFile {
    relative_path: PathBuf,
    size: u64,
    sha256: String,
}

#[derive(Debug, Clone)]
pub struct RecognizerRuntime {
    pub python: PathBuf,
    pub module_root: PathBuf,
    pub model_cache: PathBuf,
    pub component_version: Option<String>,
    pub source: String,
    model_files: Vec<RuntimeModelFile>,
    model_fingerprint: Option<String>,
}

impl RecognizerRuntime {
    pub fn component_root(&self) -> Option<PathBuf> {
        let python_root = self.python.parent()?;
        let module_root = self.module_root.parent()?;
        if python_root == module_root {
            return Some(python_root.to_path_buf());
        }
        if python_root.parent() == Some(module_root) {
            return Some(module_root.to_path_buf());
        }
        if module_root.parent() == Some(python_root) {
            return Some(python_root.to_path_buf());
        }
        common_parent(&self.python, &self.module_root)
    }

    fn cache_key(&self, probe_level: &str) -> String {
        format!(
            "{probe_level}|{}|{}|{}|{}",
            self.component_version.as_deref().unwrap_or("development"),
            self.source,
            self.python.to_string_lossy(),
            self.model_fingerprint
                .as_deref()
                .unwrap_or("unfingerprinted")
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OcrProbeReport {
    pub ok: bool,
    pub level: String,
    #[serde(flatten)]
    pub detail: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrComponentStatus {
    pub state: OcrComponentState,
    pub component_version: Option<String>,
    pub source: Option<String>,
    pub message: String,
    pub can_prepare: bool,
    pub diagnostic_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OcrComponentState {
    Ready,
    Missing,
    Corrupt,
    RuntimeFailed,
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

#[derive(Debug)]
struct ProbeFailure {
    message: String,
    diagnostic_id: String,
}

#[derive(Debug)]
struct ProcessOutcome {
    exit_code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
}

pub fn read_status(app: &AppHandle) -> OcrComponentStatus {
    let (runtime, can_prepare) = match resolve_runtime_for_status(app) {
        Ok(value) => value,
        Err(status) => return status,
    };
    match ensure_quick_probe(app, &runtime) {
        Ok(_) => ready_status(
            &runtime.source,
            runtime.component_version.clone(),
            can_prepare,
        ),
        Err(failure) => runtime_failed_status(
            &runtime.source,
            runtime.component_version.clone(),
            failure.message,
            failure.diagnostic_id,
        ),
    }
}

pub fn prepare(app: &AppHandle) -> Result<OcrComponentStatus, String> {
    if resolve_configured_runtime()?.is_some() {
        return Ok(read_status(app));
    }
    if cfg!(debug_assertions) {
        resolve_development_runtime()?;
        return Ok(read_status(app));
    }

    let resource_root = resource_root(app)?;
    let manifest = read_manifest(&resource_root.join(COMPONENT_MANIFEST_FILE))?;
    validate_manifest(&manifest)?;
    if !manifest.available {
        return Err("当前安装包尚未包含可准备的离线识别组件".into());
    }
    let destination = installed_version_root(app, &manifest.component_version)?;
    install_component(&resource_root, &destination, &manifest)?;
    let status = read_status(app);
    if status.state != OcrComponentState::Ready {
        return Err(status.message);
    }
    Ok(status)
}

pub fn resolve_runtime(app: &AppHandle) -> Result<RecognizerRuntime, String> {
    let runtime_result = if let Some(runtime) = resolve_configured_runtime()
        .map_err(|error| component_resolution_failure(app, "configured-runtime", error))?
    {
        Ok(runtime)
    } else if cfg!(debug_assertions) {
        resolve_development_runtime()
    } else {
        resolve_release_runtime(app, true)
    };
    let runtime = runtime_result
        .map_err(|error| component_resolution_failure(app, "component-verification", error))?;
    ensure_quick_probe(app, &runtime).map_err(|failure| {
        ocr_diagnostics::user_error(
            &failure.diagnostic_id,
            "本地截图识别运行时检查失败。",
            &failure.message,
        )
    })?;
    Ok(runtime)
}

pub fn run_initialization_probe(app: &AppHandle) -> Result<OcrProbeReport, String> {
    let runtime = resolve_runtime(app)?;
    let key = runtime.cache_key("initialize");
    if let Some(cached) = INITIALIZATION_PROBE_SUCCESSES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "无法读取 OCR 初始化探针缓存".to_owned())?
        .get(&key)
        .cloned()
    {
        return Ok(cached);
    }
    let report = run_probe(
        app,
        &runtime,
        "initialize",
        &["initialize", "--inference"],
        INITIALIZATION_PROBE_TIMEOUT,
    )
    .map_err(|failure| {
        ocr_diagnostics::user_error(
            &failure.diagnostic_id,
            "本地截图识别模型初始化失败。",
            &failure.message,
        )
    })?;
    INITIALIZATION_PROBE_SUCCESSES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "无法更新 OCR 初始化探针缓存".to_owned())?
        .insert(key, report.clone());
    Ok(report)
}

pub fn isolated_python_command(
    runtime: &RecognizerRuntime,
    module: &str,
) -> Result<Command, String> {
    isolated_python_command_with_model_access(runtime, module, true)
}

fn isolated_python_command_with_model_access(
    runtime: &RecognizerRuntime,
    module: &str,
    require_ascii_models: bool,
) -> Result<Command, String> {
    fs::create_dir_all(runtime.model_cache.join("paddleocr"))
        .map_err(|error| format!("无法准备 PaddleOCR 模型目录：{error}"))?;
    fs::create_dir_all(runtime.model_cache.join("paddlex"))
        .map_err(|error| format!("无法准备 PaddleX 模型目录：{error}"))?;

    let inherited = env::vars_os().collect::<BTreeMap<_, _>>();
    let effective_model_cache = if require_ascii_models {
        prepare_paddle_model_cache(runtime, &inherited)?
    } else {
        runtime.model_cache.clone()
    };
    let environment = build_isolated_environment(runtime, &effective_model_cache, &inherited)?;
    let mut command = Command::new(&runtime.python);
    command
        .current_dir(&runtime.module_root)
        .env_clear()
        .envs(environment)
        .arg("-I")
        .arg("-B")
        .arg("-c")
        .arg(PYTHON_BOOTSTRAP)
        .arg(&runtime.module_root)
        .arg(module);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    Ok(command)
}

fn resolve_runtime_for_status(
    app: &AppHandle,
) -> Result<(RecognizerRuntime, bool), OcrComponentStatus> {
    match resolve_configured_runtime() {
        Ok(Some(runtime)) => return Ok((runtime, false)),
        Err(error) => return Err(corrupt_status("configured", None, error, false)),
        Ok(None) => {}
    }

    if cfg!(debug_assertions) {
        return resolve_development_runtime()
            .map(|runtime| (runtime, false))
            .map_err(|error| OcrComponentStatus {
                state: OcrComponentState::Missing,
                component_version: None,
                source: Some("development".into()),
                message: error,
                can_prepare: false,
                diagnostic_id: None,
            });
    }

    let resource_root = resource_root(app).map_err(|error| {
        status_component_failure(
            app,
            None,
            OcrComponentState::Unavailable,
            "bundled",
            None,
            false,
            "未找到安装包内的离线识别组件。",
            error,
        )
    })?;
    let manifest = read_manifest(&resource_root.join(COMPONENT_MANIFEST_FILE))
        .and_then(|manifest| {
            validate_manifest(&manifest)?;
            Ok(manifest)
        })
        .map_err(|error| {
            status_component_failure(
                app,
                None,
                OcrComponentState::Unavailable,
                "bundled",
                None,
                false,
                "离线识别组件清单无效。",
                error,
            )
        })?;
    if !manifest.available {
        return Err(unavailable_status(
            "当前安装包尚未包含离线识别组件。".into(),
        ));
    }

    let installed_root =
        installed_version_root(app, &manifest.component_version).map_err(|error| {
            status_component_failure(
                app,
                None,
                OcrComponentState::Unavailable,
                "installed",
                Some(manifest.component_version.clone()),
                false,
                "无法定位本地识别组件。",
                error,
            )
        })?;
    if installed_root.exists() {
        let runtime = runtime_from_root(&installed_root, &manifest, "installed");
        return inspect_component_dir(&installed_root, &manifest)
            .map(|()| (runtime.clone(), false))
            .map_err(|error| {
                status_component_failure(
                    app,
                    Some(&runtime),
                    OcrComponentState::Corrupt,
                    "installed",
                    Some(manifest.component_version),
                    true,
                    "本地识别组件不完整或已损坏，可以重新准备并自动修复。",
                    error,
                )
            });
    }

    let runtime = runtime_from_root(&resource_root, &manifest, "bundled");
    inspect_component_dir(&resource_root, &manifest)
        .map(|()| (runtime.clone(), false))
        .map_err(|error| {
            status_component_failure(
                app,
                Some(&runtime),
                OcrComponentState::Unavailable,
                "bundled",
                Some(manifest.component_version),
                false,
                "安装包内的离线识别组件不完整。",
                error,
            )
        })
}

fn resolve_release_runtime(app: &AppHandle, verify_all: bool) -> Result<RecognizerRuntime, String> {
    let resource_root = resource_root(app)?;
    let manifest = read_manifest(&resource_root.join(COMPONENT_MANIFEST_FILE))?;
    validate_manifest(&manifest)?;
    if !manifest.available {
        return Err("当前安装包尚未包含离线识别组件，请安装支持截图识别的版本。".into());
    }

    let installed_root = installed_version_root(app, &manifest.component_version)?;
    if installed_root.exists() {
        if verify_all {
            verify_component_dir(&installed_root, &manifest)
                .map_err(|error| format!("installed component verification failed: {error}"))?;
        } else {
            inspect_component_dir(&installed_root, &manifest)?;
        }
        return Ok(runtime_from_root(&installed_root, &manifest, "installed"));
    }

    if verify_all {
        verify_bundled_component(&resource_root, &manifest)
            .map_err(|error| format!("bundled component verification failed: {error}"))?;
    } else {
        inspect_component_dir(&resource_root, &manifest)?;
    }
    Ok(runtime_from_root(&resource_root, &manifest, "bundled"))
}

fn ensure_quick_probe(
    app: &AppHandle,
    runtime: &RecognizerRuntime,
) -> Result<OcrProbeReport, ProbeFailure> {
    let key = runtime.cache_key("quick");
    if let Ok(cache) = QUICK_PROBE_SUCCESSES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        if let Some(report) = cache.get(&key) {
            return Ok(report.clone());
        }
    }
    let report = run_probe(app, runtime, "quick-probe", &["quick"], QUICK_PROBE_TIMEOUT)?;
    if let Ok(mut cache) = QUICK_PROBE_SUCCESSES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        cache.insert(key, report.clone());
    }
    Ok(report)
}

fn run_probe(
    app: &AppHandle,
    runtime: &RecognizerRuntime,
    stage: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<OcrProbeReport, ProbeFailure> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let output_root = env::temp_dir().join(format!(
        "course-widget-ocr-probe-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&output_root).map_err(|error| {
        probe_setup_failure(
            app,
            runtime,
            stage,
            format!("could not create probe output directory: {error}"),
        )
    })?;
    let stdout_path = output_root.join("stdout.log");
    let stderr_path = output_root.join("stderr.log");
    let stdout_file = fs::File::create(&stdout_path).map_err(|error| {
        probe_setup_failure(
            app,
            runtime,
            stage,
            format!("could not create probe stdout: {error}"),
        )
    })?;
    let stderr_file = fs::File::create(&stderr_path).map_err(|error| {
        probe_setup_failure(
            app,
            runtime,
            stage,
            format!("could not create probe stderr: {error}"),
        )
    })?;

    let requires_models = args
        .iter()
        .any(|argument| matches!(*argument, "initialize" | "--inference"));
    let mut command = isolated_python_command_with_model_access(
        runtime,
        "experiments.screenshot_import.runtime_probe",
        requires_models,
    )
    .map_err(|message| probe_setup_failure(app, runtime, stage, message))?;
    command
        .args(args)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));
    let mut child = command.spawn().map_err(|error| {
        probe_setup_failure(app, runtime, stage, format!("spawn failed: {error}"))
    })?;
    let (exit_code, timed_out) = wait_for_probe(&mut child, timeout)
        .map_err(|message| probe_setup_failure(app, runtime, stage, message))?;
    let outcome = ProcessOutcome {
        exit_code,
        stdout: fs::read(&stdout_path).unwrap_or_default(),
        stderr: fs::read(&stderr_path).unwrap_or_default(),
        timed_out,
    };
    let _ = fs::remove_dir_all(&output_root);

    let report = parse_probe_report(&outcome.stdout);
    if outcome.timed_out || outcome.exit_code != Some(0) || report.as_ref().is_err() {
        let parsed_message = report
            .as_ref()
            .err()
            .cloned()
            .or_else(|| probe_message(&outcome.stdout))
            .unwrap_or_else(|| "OCR runtime probe failed without a structured message".into());
        let diagnostic_id = ocr_diagnostics::record(
            app,
            Some(runtime),
            DiagnosticEvidence {
                stage: stage.into(),
                exit_code: outcome.exit_code,
                stdout: outcome.stdout,
                stderr: outcome.stderr,
                timed_out: outcome.timed_out,
                cancelled: false,
                error_category: Some(if outcome.timed_out {
                    "probe-timeout".into()
                } else {
                    "probe-failed".into()
                }),
                detail: Some(parsed_message.clone()),
            },
        );
        return Err(ProbeFailure {
            message: parsed_message,
            diagnostic_id,
        });
    }
    report.map_err(|message| probe_setup_failure(app, runtime, stage, message))
}

fn component_resolution_failure(app: &AppHandle, stage: &str, message: String) -> String {
    let diagnostic_id = ocr_diagnostics::record(
        app,
        None,
        DiagnosticEvidence {
            stage: stage.into(),
            error_category: Some("component-resolution".into()),
            detail: Some(message.clone()),
            ..DiagnosticEvidence::default()
        },
    );
    ocr_diagnostics::user_error(&diagnostic_id, "本地截图识别组件检查失败。", &message)
}

fn probe_setup_failure(
    app: &AppHandle,
    runtime: &RecognizerRuntime,
    stage: &str,
    message: String,
) -> ProbeFailure {
    let diagnostic_id = ocr_diagnostics::record(
        app,
        Some(runtime),
        DiagnosticEvidence {
            stage: stage.into(),
            error_category: Some("probe-launch".into()),
            detail: Some(message.clone()),
            ..DiagnosticEvidence::default()
        },
    );
    ProbeFailure {
        message,
        diagnostic_id,
    }
}

fn parse_probe_report(stdout: &[u8]) -> Result<OcrProbeReport, String> {
    let decoded = String::from_utf8_lossy(stdout);
    for line in decoded.lines().rev() {
        if let Ok(report) = serde_json::from_str::<OcrProbeReport>(line.trim()) {
            if report.ok {
                return Ok(report);
            }
            return Err(report
                .detail
                .get("message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("OCR runtime probe returned a failure")
                .to_owned());
        }
    }
    Err("OCR runtime probe did not return structured JSON".into())
}

fn probe_message(stdout: &[u8]) -> Option<String> {
    let decoded = String::from_utf8_lossy(stdout);
    for line in decoded.lines().rev() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if let Some(message) = value.get("message").and_then(serde_json::Value::as_str) {
                return Some(message.to_owned());
            }
        }
    }
    None
}

fn wait_for_probe(
    child: &mut std::process::Child,
    timeout: Duration,
) -> Result<(Option<i32>, bool), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("could not read probe status: {error}"))?
        {
            return Ok((status.code(), false));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let status = child
                .wait()
                .map_err(|error| format!("could not wait for timed-out probe: {error}"))?;
            return Ok((status.code(), true));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn build_isolated_environment(
    runtime: &RecognizerRuntime,
    effective_model_cache: &Path,
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<BTreeMap<OsString, OsString>, String> {
    let python_root = runtime
        .python
        .parent()
        .ok_or_else(|| "无法定位打包 Python 根目录".to_owned())?;
    let mut values = BTreeMap::new();

    for name in [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "PROGRAMDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "COMSPEC",
        "PATHEXT",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
        "PROCESSOR_IDENTIFIER",
        "OS",
    ] {
        if let Some(value) = lookup_env(inherited, name) {
            values.insert(OsString::from(name), value.to_os_string());
        }
    }

    #[cfg(windows)]
    let path_entries = {
        let system_root = lookup_env(inherited, "SystemRoot")
            .or_else(|| lookup_env(inherited, "WINDIR"))
            .ok_or_else(|| "Windows OCR 子进程缺少 SystemRoot/WINDIR".to_owned())?;
        vec![
            python_root.to_path_buf(),
            PathBuf::from(system_root).join("System32"),
        ]
    };
    #[cfg(not(windows))]
    let path_entries = vec![python_root.to_path_buf(), PathBuf::from("/usr/bin")];

    values.insert(
        OsString::from("PATH"),
        env::join_paths(path_entries).map_err(|error| format!("无法构建隔离 OCR PATH：{error}"))?,
    );
    values.insert(OsString::from("PYTHONNOUSERSITE"), OsString::from("1"));
    values.insert(
        OsString::from("PYTHONDONTWRITEBYTECODE"),
        OsString::from("1"),
    );
    values.insert(OsString::from("PYTHONUTF8"), OsString::from("1"));
    values.insert(OsString::from("PYTHONIOENCODING"), OsString::from("utf-8"));
    values.insert(
        OsString::from("PADDLE_PDX_MODEL_SOURCE"),
        OsString::from("BOS"),
    );
    values.insert(
        OsString::from("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"),
        OsString::from("1"),
    );
    values.insert(
        OsString::from("PADDLE_OCR_BASE_DIR"),
        effective_model_cache.join("paddleocr").into_os_string(),
    );
    values.insert(
        OsString::from("PADDLE_PDX_CACHE_HOME"),
        effective_model_cache.join("paddlex").into_os_string(),
    );
    values.insert(OsString::from("OMP_NUM_THREADS"), OsString::from("2"));
    values.insert(
        OsString::from("HTTP_PROXY"),
        OsString::from("http://127.0.0.1:9"),
    );
    values.insert(
        OsString::from("HTTPS_PROXY"),
        OsString::from("http://127.0.0.1:9"),
    );
    values.insert(
        OsString::from("ALL_PROXY"),
        OsString::from("http://127.0.0.1:9"),
    );
    values.insert(OsString::from("NO_PROXY"), OsString::new());
    Ok(values)
}

fn runtime_model_files(manifest: &OcrComponentManifest) -> Vec<RuntimeModelFile> {
    let normalized_root = manifest.model_cache_relative_path.replace('\\', "/");
    let prefix = format!("{}/", normalized_root.trim_end_matches('/'));
    manifest
        .files
        .iter()
        .filter_map(|file| {
            let normalized = file.path.replace('\\', "/");
            let relative = normalized.strip_prefix(&prefix)?;
            if relative.is_empty() {
                return None;
            }
            Some(RuntimeModelFile {
                relative_path: PathBuf::from(relative),
                size: file.size,
                sha256: file.sha256.clone(),
            })
        })
        .collect()
}

fn runtime_model_fingerprint(files: &[RuntimeModelFile]) -> Option<String> {
    if files.is_empty() {
        return None;
    }
    let mut ordered = files.to_vec();
    ordered.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let mut hasher = Sha256::new();
    for file in ordered {
        hasher.update(file.relative_path.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(file.size.to_le_bytes());
        hasher.update(file.sha256.as_bytes());
        hasher.update([0]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn path_is_ascii(path: &Path) -> bool {
    path.as_os_str().to_string_lossy().is_ascii()
}

#[cfg(not(windows))]
fn prepare_paddle_model_cache(
    runtime: &RecognizerRuntime,
    _inherited: &BTreeMap<OsString, OsString>,
) -> Result<PathBuf, String> {
    Ok(runtime.model_cache.clone())
}

#[cfg(windows)]
fn prepare_paddle_model_cache(
    runtime: &RecognizerRuntime,
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<PathBuf, String> {
    if path_is_ascii(&runtime.model_cache) {
        return Ok(runtime.model_cache.clone());
    }
    if let Ok(short_path) = windows_short_path(&runtime.model_cache) {
        if path_is_ascii(&short_path) {
            return Ok(short_path);
        }
    }

    let fingerprint = runtime.model_fingerprint.as_deref().ok_or_else(|| {
        "Paddle 模型路径包含非 ASCII 字符，且当前运行时缺少可验证的模型清单".to_owned()
    })?;
    let base = writable_ascii_model_cache_base(inherited)?;
    let version = ascii_component_slug(
        runtime
            .component_version
            .as_deref()
            .unwrap_or("development"),
    );
    let mut owner_hasher = Sha256::new();
    if let Some(profile) = lookup_env(inherited, "USERPROFILE") {
        owner_hasher.update(profile.to_string_lossy().as_bytes());
    }
    owner_hasher.update(runtime.model_cache.to_string_lossy().as_bytes());
    let owner_hash = format!("{:x}", owner_hasher.finalize());
    let target = base.join(format!(
        "{}-{}-{}",
        version,
        &fingerprint[..16],
        &owner_hash[..12]
    ));
    let cache_key = target.to_string_lossy().to_string();
    if VERIFIED_ASCII_MODEL_CACHES
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map_err(|_| "无法读取 ASCII 模型缓存状态".to_owned())?
        .contains(&cache_key)
    {
        return Ok(target);
    }

    if verify_runtime_model_cache(&target, &runtime.model_files).is_err() {
        populate_ascii_model_cache(runtime, &target)?;
    }
    verify_runtime_model_cache(&target, &runtime.model_files)?;
    VERIFIED_ASCII_MODEL_CACHES
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map_err(|_| "无法更新 ASCII 模型缓存状态".to_owned())?
        .insert(cache_key);
    Ok(target)
}

#[cfg(windows)]
fn windows_short_path(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err("无法为不存在的 Paddle 模型目录创建短路径".into());
    }
    let wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let required = unsafe { GetShortPathNameW(wide.as_ptr(), std::ptr::null_mut(), 0) };
    if required == 0 {
        return Err(format!(
            "Windows 无法解析 Paddle 模型短路径：{}",
            std::io::Error::last_os_error()
        ));
    }
    let mut buffer = vec![0_u16; required as usize + 1];
    let written =
        unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };
    if written == 0 || written as usize >= buffer.len() {
        return Err(format!(
            "Windows 无法读取 Paddle 模型短路径：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(PathBuf::from(OsString::from_wide(
        &buffer[..written as usize],
    )))
}

#[cfg(windows)]
fn writable_ascii_model_cache_base(
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    for name in ["LOCALAPPDATA", "TEMP", "TMP"] {
        let Some(value) = lookup_env(inherited, name) else {
            continue;
        };
        let original = PathBuf::from(value);
        let base = if path_is_ascii(&original) {
            Some(original)
        } else {
            windows_short_path(&original)
                .ok()
                .filter(|path| path_is_ascii(path))
        };
        if let Some(base) = base {
            candidates.push(base.join(ASCII_MODEL_CACHE_DIR));
        }
    }
    if let Some(system_root) =
        lookup_env(inherited, "SystemRoot").or_else(|| lookup_env(inherited, "WINDIR"))
    {
        candidates.push(
            PathBuf::from(system_root)
                .join("Temp")
                .join(ASCII_MODEL_CACHE_DIR),
        );
    }

    for candidate in candidates {
        if !path_is_ascii(&candidate) || fs::create_dir_all(&candidate).is_err() {
            continue;
        }
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let probe = candidate.join(format!(".write-probe-{}-{nonce}", std::process::id()));
        if fs::write(&probe, b"ok").is_ok() {
            let _ = fs::remove_file(probe);
            return Ok(candidate);
        }
    }
    Err("无法创建可写且仅含 ASCII 字符的 Paddle 模型运行目录".into())
}

#[cfg(windows)]
fn ascii_component_slug(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if slug.is_empty() {
        slug.push_str("component");
    }
    slug
}

#[cfg(windows)]
fn verify_runtime_model_cache(root: &Path, files: &[RuntimeModelFile]) -> Result<(), String> {
    if files.is_empty() {
        return Err("ASCII 模型缓存缺少可验证的文件清单".into());
    }
    for expected in files {
        let path = root.join(&expected.relative_path);
        let metadata = fs::metadata(&path).map_err(|error| {
            format!(
                "ASCII 模型缓存文件缺失：{}：{error}",
                expected.relative_path.display()
            )
        })?;
        if !metadata.is_file() || metadata.len() != expected.size {
            return Err(format!(
                "ASCII 模型缓存文件大小不匹配：{}",
                expected.relative_path.display()
            ));
        }
        if sha256_file(&path)? != expected.sha256 {
            return Err(format!(
                "ASCII 模型缓存文件校验失败：{}",
                expected.relative_path.display()
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn populate_ascii_model_cache(runtime: &RecognizerRuntime, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "无法定位 ASCII 模型缓存父目录".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建 ASCII 模型缓存目录：{error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let staging = parent.join(format!(".staging-{}-{nonce}", std::process::id()));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging)
        .map_err(|error| format!("无法创建 ASCII 模型缓存暂存目录：{error}"))?;

    let copy_result = (|| {
        for expected in &runtime.model_files {
            let source = runtime.model_cache.join(&expected.relative_path);
            let destination = staging.join(&expected.relative_path);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("无法创建 ASCII 模型缓存子目录：{error}"))?;
            }
            fs::copy(&source, &destination).map_err(|error| {
                format!(
                    "无法复制 Paddle 模型文件 {}：{error}",
                    expected.relative_path.display()
                )
            })?;
        }
        verify_runtime_model_cache(&staging, &runtime.model_files)
    })();
    if let Err(error) = copy_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if target.exists() {
        if verify_runtime_model_cache(target, &runtime.model_files).is_ok() {
            let _ = fs::remove_dir_all(&staging);
            return Ok(());
        }
        fs::remove_dir_all(target)
            .map_err(|error| format!("无法替换损坏的 ASCII 模型缓存：{error}"))?;
    }
    match fs::rename(&staging, target) {
        Ok(()) => Ok(()),
        Err(_error) if verify_runtime_model_cache(target, &runtime.model_files).is_ok() => {
            let _ = fs::remove_dir_all(&staging);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(format!("无法启用 ASCII 模型缓存：{error}"))
        }
    }
}

fn lookup_env<'a>(values: &'a BTreeMap<OsString, OsString>, name: &str) -> Option<&'a OsStr> {
    values
        .iter()
        .find(|(key, _)| key.to_string_lossy().eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_os_str())
}

#[allow(clippy::too_many_arguments)]
fn status_component_failure(
    app: &AppHandle,
    runtime: Option<&RecognizerRuntime>,
    state: OcrComponentState,
    source: &str,
    component_version: Option<String>,
    can_prepare: bool,
    user_message: &str,
    technical_detail: String,
) -> OcrComponentStatus {
    let diagnostic_id = ocr_diagnostics::record(
        app,
        runtime,
        DiagnosticEvidence {
            stage: "component-status".into(),
            error_category: Some("component-status".into()),
            detail: Some(technical_detail),
            ..DiagnosticEvidence::default()
        },
    );
    OcrComponentStatus {
        state,
        component_version,
        source: Some(source.into()),
        message: format!("{user_message} 诊断编号：{diagnostic_id}"),
        can_prepare,
        diagnostic_id: Some(diagnostic_id),
    }
}

fn ready_status(
    source: &str,
    component_version: Option<String>,
    can_prepare: bool,
) -> OcrComponentStatus {
    OcrComponentStatus {
        state: OcrComponentState::Ready,
        component_version,
        source: Some(source.into()),
        message: "本地识别运行时已通过隔离导入检查，课表图片不会上传。".into(),
        can_prepare,
        diagnostic_id: None,
    }
}

fn corrupt_status(
    source: &str,
    component_version: Option<String>,
    message: String,
    can_prepare: bool,
) -> OcrComponentStatus {
    OcrComponentStatus {
        state: OcrComponentState::Corrupt,
        component_version,
        source: Some(source.into()),
        message,
        can_prepare,
        diagnostic_id: None,
    }
}

fn runtime_failed_status(
    source: &str,
    component_version: Option<String>,
    _message: String,
    diagnostic_id: String,
) -> OcrComponentStatus {
    OcrComponentStatus {
        state: OcrComponentState::RuntimeFailed,
        component_version,
        source: Some(source.into()),
        message: format!("本地截图识别运行时检查失败。诊断编号：{diagnostic_id}"),
        can_prepare: false,
        diagnostic_id: Some(diagnostic_id),
    }
}

pub fn unavailable_status(message: String) -> OcrComponentStatus {
    OcrComponentStatus {
        state: OcrComponentState::Unavailable,
        component_version: None,
        source: Some("bundled".into()),
        message,
        can_prepare: false,
        diagnostic_id: None,
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
                component_version: None,
                source: "configured".into(),
                model_files: Vec::new(),
                model_fingerprint: None,
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
        component_version: None,
        source: "development".into(),
        model_files: Vec::new(),
        model_fingerprint: None,
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

fn runtime_from_root(
    root: &Path,
    manifest: &OcrComponentManifest,
    source: &str,
) -> RecognizerRuntime {
    let model_files = runtime_model_files(manifest);
    let model_fingerprint = runtime_model_fingerprint(&model_files);
    RecognizerRuntime {
        python: root.join(&manifest.python_relative_path),
        module_root: root.join(&manifest.module_root_relative_path),
        model_cache: root.join(&manifest.model_cache_relative_path),
        component_version: Some(manifest.component_version.clone()),
        source: source.into(),
        model_files,
        model_fingerprint,
    }
}

fn resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os(OCR_RESOURCE_ROOT_ENV) {
        return Ok(PathBuf::from(path));
    }
    let base = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位安装包资源目录：{error}"))?;
    resolve_resource_root_from_base(&base)
}

fn resolve_resource_root_from_base(base: &Path) -> Result<PathBuf, String> {
    let candidates = [
        base.join(COMPONENT_RESOURCE_DIR),
        base.join("resources").join(COMPONENT_RESOURCE_DIR),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.join(COMPONENT_MANIFEST_FILE).is_file())
        .ok_or_else(|| "当前安装包中未找到本地识别组件清单。".to_owned())
}

fn component_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os(OCR_STORAGE_ROOT_ENV) {
        return Ok(PathBuf::from(path));
    }
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join(COMPONENT_STORAGE_DIR))
}

fn installed_version_root(app: &AppHandle, version: &str) -> Result<PathBuf, String> {
    Ok(component_storage_root(app)?.join("versions").join(version))
}

fn install_component(
    resource_root: &Path,
    destination: &Path,
    manifest: &OcrComponentManifest,
) -> Result<(), String> {
    verify_component_dir(resource_root, manifest)
        .map_err(|_| "安装包内的识别组件校验失败".to_owned())?;
    let versions_root = destination
        .parent()
        .ok_or_else(|| "无法定位识别组件版本目录".to_owned())?;
    fs::create_dir_all(versions_root)
        .map_err(|error| format!("无法创建本地识别组件目录：{error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法准备本地识别组件：{error}"))?
        .as_nanos();
    let staging = versions_root.join(format!(".staging-{}-{nonce}", std::process::id()));

    if let Err(error) = install_from_resource(resource_root, &staging, manifest) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if destination.exists() {
        fs::remove_dir_all(destination)
            .map_err(|error| format!("无法替换损坏的本地识别组件：{error}"))?;
    }
    fs::rename(&staging, destination).map_err(|error| format!("无法启用本地识别组件：{error}"))?;
    cleanup_other_versions(versions_root, &manifest.component_version);
    Ok(())
}

fn read_manifest(path: &Path) -> Result<OcrComponentManifest, String> {
    let bytes = fs::read(path).map_err(|error| format!("无法读取本地识别组件清单：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("本地识别组件清单格式无效：{error}"))
}

fn validate_manifest(manifest: &OcrComponentManifest) -> Result<(), String> {
    if manifest.schema_version != COMPONENT_SCHEMA_VERSION {
        return Err("本地识别组件清单版本不受支持".into());
    }
    if manifest.component_version.trim().is_empty()
        || manifest.component_version.contains('/')
        || manifest.component_version.contains('\\')
        || matches!(manifest.component_version.as_str(), "." | "..")
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
    if value
        .split(['/', '\\'])
        .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(format!("本地识别组件路径不安全：{value}"));
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

fn inspect_component_dir(root: &Path, manifest: &OcrComponentManifest) -> Result<(), String> {
    validate_manifest(manifest)?;
    if !manifest.available {
        return Err("本地识别组件不可用".into());
    }
    let runtime = runtime_from_root(root, manifest, "inspection");
    validate_runtime_paths(&runtime.python, &runtime.module_root)?;
    if !runtime.model_cache.is_dir() {
        return Err("本地识别组件模型目录不存在".into());
    }
    let python_entry = manifest
        .files
        .iter()
        .find(|file| file.path == manifest.python_relative_path)
        .ok_or_else(|| "本地识别组件清单未包含 Python 入口".to_owned())?;
    let metadata = fs::metadata(&runtime.python)
        .map_err(|error| format!("本地识别组件 Python 入口不可读：{error}"))?;
    if !metadata.is_file() || metadata.len() != python_entry.size {
        return Err("本地识别组件 Python 入口大小不匹配".into());
    }
    if sha256_file(&runtime.python)? != python_entry.sha256 {
        return Err("本地识别组件 Python 入口校验失败".into());
    }
    Ok(())
}

fn verify_bundled_component(root: &Path, manifest: &OcrComponentManifest) -> Result<(), String> {
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
        if sha256_file(&path)? != expected.sha256 {
            return Err(format!("本地识别组件文件校验失败：{}", expected.path));
        }
    }
    let runtime = runtime_from_root(root, manifest, "verification");
    validate_runtime_paths(&runtime.python, &runtime.module_root)
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
            fs::create_dir_all(parent).map_err(|error| format!("无法创建识别组件目录：{error}"))?;
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
    let mut file =
        fs::File::open(path).map_err(|error| format!("无法读取识别组件文件：{error}"))?;
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
        if entry.path().is_dir() {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn common_parent(left: &Path, right: &Path) -> Option<PathBuf> {
    let left_components = left.components().collect::<Vec<_>>();
    let right_components = right.components().collect::<Vec<_>>();
    let count = left_components
        .iter()
        .zip(&right_components)
        .take_while(|(left, right)| left == right)
        .count();
    if count == 0 {
        return None;
    }
    let mut path = PathBuf::new();
    for component in &left_components[..count] {
        path.push(component.as_os_str());
    }
    Some(path)
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

    fn test_runtime(root: &Path) -> RecognizerRuntime {
        RecognizerRuntime {
            python: root.join("python/python.exe"),
            module_root: root.join("app"),
            model_cache: root.join("models"),
            component_version: Some("test-v1".into()),
            source: "test".into(),
            model_files: Vec::new(),
            model_fingerprint: None,
        }
    }

    #[test]
    fn rejects_absolute_and_parent_paths() {
        assert!(validate_relative_path("python/python.exe").is_ok());
        assert!(validate_relative_path("../python.exe").is_err());
        assert!(validate_relative_path(r"C:\python.exe").is_err());
        assert!(validate_relative_path("python/./python.exe").is_err());
        assert!(validate_relative_path("python//python.exe").is_err());
        assert!(validate_relative_path(r"python\..\python.exe").is_err());
    }

    #[test]
    fn manifest_accepts_empty_files_and_requires_python() {
        let valid = manifest(vec![
            file_record("python/python.exe", b"python"),
            file_record("app/experiments/__init__.py", b""),
        ]);
        assert!(validate_manifest(&valid).is_ok());
        assert!(validate_manifest(&manifest(vec![file_record("app/module.py", b"x")])).is_err());
    }

    #[test]
    fn isolated_environment_drops_python_conda_cuda_and_user_path() {
        let root = env::temp_dir().join("course-widget-isolated-environment");
        let runtime = test_runtime(&root);
        let mut inherited = BTreeMap::new();
        inherited.insert(OsString::from("SystemRoot"), OsString::from(r"C:\Windows"));
        inherited.insert(
            OsString::from("PATH"),
            OsString::from(r"C:\fake-python;C:\conda;C:\cuda"),
        );
        inherited.insert(OsString::from("PYTHONHOME"), OsString::from(r"C:\bad"));
        inherited.insert(OsString::from("PYTHONPATH"), OsString::from(r"C:\bad-site"));
        inherited.insert(OsString::from("VIRTUAL_ENV"), OsString::from(r"C:\venv"));
        inherited.insert(OsString::from("CONDA_PREFIX"), OsString::from(r"C:\conda"));
        inherited.insert(OsString::from("CUDA_PATH"), OsString::from(r"C:\cuda"));

        let isolated =
            build_isolated_environment(&runtime, &runtime.model_cache, &inherited).unwrap();
        let keys = isolated
            .keys()
            .map(|key| key.to_string_lossy().to_ascii_uppercase())
            .collect::<HashSet<_>>();
        for polluted in [
            "PYTHONHOME",
            "PYTHONPATH",
            "VIRTUAL_ENV",
            "CONDA_PREFIX",
            "CONDA_DEFAULT_ENV",
            "CUDA_PATH",
            "CUDA_HOME",
            "PADDLE_HOME",
            "LD_LIBRARY_PATH",
        ] {
            assert!(!keys.contains(polluted));
        }
        let path = isolated.get(OsStr::new("PATH")).unwrap().to_string_lossy();
        assert!(path.contains("python"));
        assert!(path.to_ascii_lowercase().contains("system32"));
        assert!(!path.contains("fake-python"));
        assert!(!path.contains("conda"));
        assert!(!path.contains("cuda"));
    }

    #[test]
    fn model_manifest_fingerprint_is_stable_and_sensitive() {
        let first = RuntimeModelFile {
            relative_path: PathBuf::from("paddlex/model/inference.json"),
            size: 12,
            sha256: "a".repeat(64),
        };
        let mut changed = first.clone();
        changed.sha256 = "b".repeat(64);
        assert_eq!(
            runtime_model_fingerprint(std::slice::from_ref(&first)),
            runtime_model_fingerprint(std::slice::from_ref(&first))
        );
        assert_ne!(
            runtime_model_fingerprint(std::slice::from_ref(&first)),
            runtime_model_fingerprint(std::slice::from_ref(&changed))
        );
    }

    #[test]
    fn isolated_command_disables_bytecode_writes_at_cli_level() {
        let root = env::temp_dir().join(format!(
            "course-widget-ocr-no-bytecode-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let runtime = test_runtime(&root);
        let command = isolated_python_command_with_model_access(
            &runtime,
            "experiments.screenshot_import.bootstrap_probe",
            false,
        )
        .unwrap();
        let args = command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(args.get(0).map(String::as_str), Some("-I"));
        assert_eq!(args.get(1).map(String::as_str), Some("-B"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bootstrap_explicitly_inserts_module_root_under_isolated_mode() {
        assert!(PYTHON_BOOTSTRAP.contains("sys.path.insert(0,root)"));
        assert!(PYTHON_BOOTSTRAP.contains("runpy.run_module"));
    }

    #[test]
    fn readiness_inspection_checks_required_runtime_paths() {
        let root = env::temp_dir().join(format!(
            "course-widget-ocr-inspection-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("python")).unwrap();
        fs::create_dir_all(root.join("app/experiments/screenshot_import")).unwrap();
        fs::create_dir_all(root.join("models")).unwrap();
        fs::write(root.join("python/python.exe"), b"python").unwrap();
        let manifest = manifest(vec![file_record("python/python.exe", b"python")]);
        assert!(inspect_component_dir(&root, &manifest).is_ok());
        fs::write(root.join("python/python.exe"), b"changed").unwrap();
        assert!(inspect_component_dir(&root, &manifest).is_err());
        let _ = fs::remove_dir_all(root);
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
        fs::create_dir_all(source.join("models")).unwrap();
        fs::write(source.join("python/python.exe"), b"python").unwrap();
        fs::write(
            source.join("app/experiments/screenshot_import/__init__.py"),
            b"",
        )
        .unwrap();
        fs::write(source.join("unlisted.txt"), b"ignore").unwrap();
        let manifest = manifest(vec![
            file_record("python/python.exe", b"python"),
            file_record("app/experiments/screenshot_import/__init__.py", b""),
        ]);

        install_from_resource(&source, &destination, &manifest).unwrap();
        assert!(!destination.join("unlisted.txt").exists());
        assert!(verify_component_dir(&destination, &manifest).is_ok());
        fs::write(destination.join("python/python.exe"), b"changed").unwrap();
        assert!(verify_component_dir(&destination, &manifest).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_both_tauri_resource_layouts() {
        let root = env::temp_dir().join(format!(
            "course-widget-ocr-resource-layout-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);

        let direct = root.join(COMPONENT_RESOURCE_DIR);
        fs::create_dir_all(&direct).unwrap();
        fs::write(direct.join(COMPONENT_MANIFEST_FILE), b"{}").unwrap();
        assert_eq!(resolve_resource_root_from_base(&root).unwrap(), direct);

        fs::remove_dir_all(root.join(COMPONENT_RESOURCE_DIR)).unwrap();
        let nested = root.join("resources").join(COMPONENT_RESOURCE_DIR);
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join(COMPONENT_MANIFEST_FILE), b"{}").unwrap();
        assert_eq!(resolve_resource_root_from_base(&root).unwrap(), nested);

        fs::remove_dir_all(&nested).unwrap();
        assert!(resolve_resource_root_from_base(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
