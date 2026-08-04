use std::{
    collections::VecDeque,
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU32, AtomicUsize, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::ocr_component::{self, RecognizerRuntime};

const WORKER_START_TIMEOUT: Duration = Duration::from_secs(60);
const RECOGNITION_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_LOG_LINES: usize = 200;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static WORKER: OnceLock<Mutex<Option<OcrWorker>>> = OnceLock::new();
static CURRENT_WORKER_PID: AtomicU32 = AtomicU32::new(0);
static WORKER_START_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrStageEvent {
    stage: String,
    title: String,
    detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerReady {
    pid: u32,
    #[serde(default)]
    initialization_seconds: Option<f64>,
    #[serde(default)]
    engine: Value,
}

#[derive(Debug, Clone)]
pub struct WorkerSuccess {
    pub timings: Value,
    pub image: Value,
    pub worker_pid: u32,
    pub worker_initialization_seconds: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct WorkerFailure {
    pub message: String,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

struct OcrWorker {
    runtime_key: String,
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    stdout_log: Arc<Mutex<VecDeque<String>>>,
    stderr_log: Arc<Mutex<VecDeque<String>>>,
    ready: WorkerReady,
}

impl OcrWorker {
    fn spawn(runtime: &RecognizerRuntime) -> Result<Self, WorkerFailure> {
        let mut command = ocr_component::isolated_python_command(
            runtime,
            "experiments.screenshot_import.worker",
        )
        .map_err(WorkerFailure::setup)?;
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|error| WorkerFailure::setup(format!("worker spawn failed: {error}")))?;
        let pid = child.id();
        CURRENT_WORKER_PID.store(pid, Ordering::SeqCst);
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| WorkerFailure::setup("worker stdin was unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| WorkerFailure::setup("worker stdout was unavailable".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| WorkerFailure::setup("worker stderr was unavailable".into()))?;

        let stdout_log = Arc::new(Mutex::new(VecDeque::new()));
        let stderr_log = Arc::new(Mutex::new(VecDeque::new()));
        let (line_tx, lines) = mpsc::channel();
        spawn_line_reader(stdout, line_tx, stdout_log.clone());
        spawn_log_reader(stderr, stderr_log.clone());

        let deadline = Instant::now() + WORKER_START_TIMEOUT;
        let ready = loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let _ = child.kill();
                let _ = child.wait();
                CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
                return Err(WorkerFailure {
                    message: "OCR worker initialization exceeded 60 seconds".into(),
                    stdout: log_bytes(&stdout_log),
                    stderr: log_bytes(&stderr_log),
                    exit_code: None,
                    timed_out: true,
                });
            }
            match lines.recv_timeout(remaining.min(Duration::from_millis(250))) {
                Ok(line) => {
                    let Ok(value) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    match value.get("event").and_then(Value::as_str) {
                        Some("ready") => {
                            let parsed = serde_json::from_value::<WorkerReady>(value).map_err(
                                |error| {
                                    WorkerFailure::setup(format!(
                                        "worker ready payload was invalid: {error}"
                                    ))
                                },
                            )?;
                            break parsed;
                        }
                        Some("fatal") => {
                            let message = value
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("OCR worker failed during initialization")
                                .to_owned();
                            let _ = child.wait();
                            CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
                            return Err(WorkerFailure {
                                message,
                                stdout: log_bytes(&stdout_log),
                                stderr: log_bytes(&stderr_log),
                                exit_code: child.try_wait().ok().flatten().and_then(|s| s.code()),
                                timed_out: false,
                            });
                        }
                        _ => {}
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(status) = child.try_wait().map_err(|error| {
                        WorkerFailure::setup(format!("could not inspect OCR worker: {error}"))
                    })? {
                        CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
                        return Err(WorkerFailure {
                            message: "OCR worker exited before becoming ready".into(),
                            stdout: log_bytes(&stdout_log),
                            stderr: log_bytes(&stderr_log),
                            exit_code: status.code(),
                            timed_out: false,
                        });
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    let status = child.try_wait().ok().flatten();
                    CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
                    return Err(WorkerFailure {
                        message: "OCR worker output closed before initialization completed".into(),
                        stdout: log_bytes(&stdout_log),
                        stderr: log_bytes(&stderr_log),
                        exit_code: status.and_then(|value| value.code()),
                        timed_out: false,
                    });
                }
            }
        };

        WORKER_START_COUNT.fetch_add(1, Ordering::SeqCst);
        Ok(Self {
            runtime_key: runtime_key(runtime),
            child,
            stdin,
            lines,
            stdout_log,
            stderr_log,
            ready,
        })
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn recognize(
        &mut self,
        app: &AppHandle,
        runtime: &RecognizerRuntime,
        request_id: &str,
        image_path: &Path,
        output_path: &Path,
    ) -> Result<WorkerSuccess, WorkerFailure> {
        let request = json!({
            "command": "recognize",
            "id": request_id,
            "input": image_path,
            "output": output_path,
            "repoRoot": runtime.module_root,
            "maxDimension": 1600,
        });
        let rendered = serde_json::to_string(&request)
            .map_err(|error| WorkerFailure::setup(format!("worker request encode failed: {error}")))?;
        self.stdin
            .write_all(rendered.as_bytes())
            .and_then(|()| self.stdin.write_all(b"\n"))
            .and_then(|()| self.stdin.flush())
            .map_err(|error| WorkerFailure {
                message: format!("could not send recognition request to OCR worker: {error}"),
                stdout: log_bytes(&self.stdout_log),
                stderr: log_bytes(&self.stderr_log),
                exit_code: self.child.try_wait().ok().flatten().and_then(|s| s.code()),
                timed_out: false,
            })?;

        let deadline = Instant::now() + RECOGNITION_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                self.terminate();
                return Err(WorkerFailure {
                    message: "OCR recognition exceeded 60 seconds".into(),
                    stdout: log_bytes(&self.stdout_log),
                    stderr: log_bytes(&self.stderr_log),
                    exit_code: None,
                    timed_out: true,
                });
            }
            match self
                .lines
                .recv_timeout(remaining.min(Duration::from_millis(250)))
            {
                Ok(line) => {
                    let Ok(value) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    let event = value.get("event").and_then(Value::as_str);
                    let id_matches = value.get("id").and_then(Value::as_str) == Some(request_id);
                    if event == Some("stage") && id_matches {
                        let stage = value
                            .get("stage")
                            .and_then(Value::as_str)
                            .unwrap_or("recognizing-text");
                        let title = value
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or("正在识别课表…");
                        let detail = value
                            .get("detail")
                            .and_then(Value::as_str)
                            .unwrap_or("图片只在本机处理。");
                        let _ = app.emit(
                            "screenshot-ocr-stage",
                            OcrStageEvent {
                                stage: stage.to_owned(),
                                title: title.to_owned(),
                                detail: detail.to_owned(),
                            },
                        );
                        continue;
                    }
                    if event == Some("result") && id_matches {
                        if value.get("ok").and_then(Value::as_bool) == Some(true) {
                            return Ok(WorkerSuccess {
                                timings: value.get("timings").cloned().unwrap_or(Value::Null),
                                image: value.get("image").cloned().unwrap_or(Value::Null),
                                worker_pid: self.ready.pid,
                                worker_initialization_seconds: self.ready.initialization_seconds,
                            });
                        }
                        let message = value
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("OCR worker returned an unknown recognition error")
                            .to_owned();
                        return Err(WorkerFailure {
                            message,
                            stdout: log_bytes(&self.stdout_log),
                            stderr: log_bytes(&self.stderr_log),
                            exit_code: None,
                            timed_out: false,
                        });
                    }
                    if event == Some("fatal") {
                        return Err(WorkerFailure {
                            message: value
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("OCR worker failed")
                                .to_owned(),
                            stdout: log_bytes(&self.stdout_log),
                            stderr: log_bytes(&self.stderr_log),
                            exit_code: self
                                .child
                                .try_wait()
                                .ok()
                                .flatten()
                                .and_then(|status| status.code()),
                            timed_out: false,
                        });
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(status) = self.child.try_wait().map_err(|error| {
                        WorkerFailure::setup(format!("could not inspect OCR worker: {error}"))
                    })? {
                        CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
                        return Err(WorkerFailure {
                            message: "OCR worker exited during recognition".into(),
                            stdout: log_bytes(&self.stdout_log),
                            stderr: log_bytes(&self.stderr_log),
                            exit_code: status.code(),
                            timed_out: false,
                        });
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    let status = self.child.try_wait().ok().flatten();
                    CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
                    return Err(WorkerFailure {
                        message: "OCR worker output closed during recognition".into(),
                        stdout: log_bytes(&self.stdout_log),
                        stderr: log_bytes(&self.stderr_log),
                        exit_code: status.and_then(|value| value.code()),
                        timed_out: false,
                    });
                }
            }
        }
    }

    fn terminate(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
    }
}

impl Drop for OcrWorker {
    fn drop(&mut self) {
        self.terminate();
    }
}

impl WorkerFailure {
    fn setup(message: String) -> Self {
        Self {
            message,
            stdout: Vec::new(),
            stderr: Vec::new(),
            exit_code: None,
            timed_out: false,
        }
    }
}

pub fn recognize(
    app: &AppHandle,
    runtime: &RecognizerRuntime,
    request_id: &str,
    image_path: &Path,
    output_path: &Path,
) -> Result<WorkerSuccess, WorkerFailure> {
    let workers = WORKER.get_or_init(|| Mutex::new(None));
    let mut slot = workers
        .lock()
        .map_err(|_| WorkerFailure::setup("OCR worker lock was poisoned".into()))?;
    let expected_key = runtime_key(runtime);
    let needs_restart = slot
        .as_mut()
        .is_none_or(|worker| worker.runtime_key != expected_key || !worker.is_alive());
    if needs_restart {
        if let Some(mut stale) = slot.take() {
            stale.terminate();
        }
        *slot = Some(OcrWorker::spawn(runtime)?);
    }
    let outcome = slot
        .as_mut()
        .expect("worker must exist after initialization")
        .recognize(app, runtime, request_id, image_path, output_path);
    if outcome.is_err() && slot.as_mut().is_some_and(|worker| !worker.is_alive()) {
        slot.take();
    }
    outcome
}

pub fn cancel() -> bool {
    let pid = CURRENT_WORKER_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return false;
    }
    terminate_process_tree(pid);
    true
}

pub fn shutdown() {
    let pid = CURRENT_WORKER_PID.load(Ordering::SeqCst);
    if pid != 0 {
        terminate_process_tree(pid);
    }
    if let Some(workers) = WORKER.get() {
        if let Ok(mut slot) = workers.try_lock() {
            slot.take();
        }
    }
}

pub fn start_count() -> usize {
    WORKER_START_COUNT.load(Ordering::SeqCst)
}

fn runtime_key(runtime: &RecognizerRuntime) -> String {
    format!(
        "{}|{}|{}|{}",
        runtime.component_version.as_deref().unwrap_or("development"),
        runtime.python.to_string_lossy(),
        runtime.module_root.to_string_lossy(),
        runtime.model_cache.to_string_lossy(),
    )
}

fn spawn_line_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    sender: mpsc::Sender<String>,
    log: Arc<Mutex<VecDeque<String>>>,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(value) => {
                    push_log(&log, value.clone());
                    if sender.send(value).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    push_log(&log, format!("stdout read failed: {error}"));
                    break;
                }
            }
        }
    });
}

fn spawn_log_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    log: Arc<Mutex<VecDeque<String>>>,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(value) => push_log(&log, value),
                Err(error) => {
                    push_log(&log, format!("stderr read failed: {error}"));
                    break;
                }
            }
        }
    });
}

fn push_log(log: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut values) = log.lock() {
        values.push_back(line);
        while values.len() > MAX_LOG_LINES {
            values.pop_front();
        }
    }
}

fn log_bytes(log: &Arc<Mutex<VecDeque<String>>>) -> Vec<u8> {
    log.lock()
        .map(|values| values.iter().cloned().collect::<Vec<_>>().join("\n").into_bytes())
        .unwrap_or_default()
}

#[cfg(windows)]
fn terminate_process_tree(pid: u32) {
    let taskkill = env::var_os("SystemRoot")
        .or_else(|| env::var_os("WINDIR"))
        .map(PathBuf::from)
        .map(|root| root.join("System32/taskkill.exe"))
        .unwrap_or_else(|| PathBuf::from("taskkill.exe"));
    let mut command = Command::new(taskkill);
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.creation_flags(CREATE_NO_WINDOW);
    let _ = command.status();
    CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
}

#[cfg(not(windows))]
fn terminate_process_tree(_pid: u32) {
    CURRENT_WORKER_PID.store(0, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_key_changes_with_component_identity() {
        let runtime = RecognizerRuntime {
            python: PathBuf::from("python/python.exe"),
            module_root: PathBuf::from("app"),
            model_cache: PathBuf::from("models"),
            component_version: Some("v1".into()),
            source: "bundled".into(),
            model_files: Vec::new(),
            model_fingerprint: None,
        };
        let first = runtime_key(&runtime);
        let mut changed = runtime.clone();
        changed.component_version = Some("v2".into());
        assert_ne!(first, runtime_key(&changed));
    }
}
