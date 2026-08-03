use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::ocr_component::RecognizerRuntime;

const DIAGNOSTIC_DIRECTORY: &str = "ocr-diagnostics";
const MAX_DIAGNOSTICS: usize = 3;
const OUTPUT_TAIL_LINES: usize = 12;
static DIAGNOSTIC_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Default)]
pub struct DiagnosticEvidence {
    pub stage: String,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub error_category: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDiagnostic {
    diagnostic_id: String,
    timestamp_utc_seconds: u64,
    app_version: String,
    component_version: Option<String>,
    runtime_source: Option<String>,
    python_path: Option<String>,
    module_path: Option<String>,
    model_path: Option<String>,
    stage: String,
    exit_code: Option<i32>,
    stdout_tail: Vec<String>,
    stderr_tail: Vec<String>,
    timed_out: bool,
    cancelled: bool,
    error_category: Option<String>,
    detail: Option<String>,
}

pub fn record(
    app: &AppHandle,
    runtime: Option<&RecognizerRuntime>,
    evidence: DiagnosticEvidence,
) -> String {
    let timestamp = unix_seconds();
    let sequence = DIAGNOSTIC_SEQUENCE.fetch_add(1, Ordering::SeqCst);
    let diagnostic_id = format!(
        "OCR-{:X}-{:X}-{:X}",
        timestamp,
        std::process::id(),
        sequence
    );
    let replacements = redaction_replacements(runtime);
    let diagnostic = StoredDiagnostic {
        diagnostic_id: diagnostic_id.clone(),
        timestamp_utc_seconds: timestamp,
        app_version: app.package_info().version.to_string(),
        component_version: runtime.and_then(|value| value.component_version.clone()),
        runtime_source: runtime.map(|value| value.source.clone()),
        python_path: runtime.map(|value| redact_path(&value.python, &replacements)),
        module_path: runtime.map(|value| redact_path(&value.module_root, &replacements)),
        model_path: runtime.map(|value| redact_path(&value.model_cache, &replacements)),
        stage: sanitize_text(&evidence.stage, &replacements),
        exit_code: evidence.exit_code,
        stdout_tail: output_tail(&evidence.stdout, &replacements),
        stderr_tail: output_tail(&evidence.stderr, &replacements),
        timed_out: evidence.timed_out,
        cancelled: evidence.cancelled,
        error_category: evidence
            .error_category
            .map(|value| sanitize_text(&value, &replacements)),
        detail: evidence
            .detail
            .map(|value| sanitize_text(&value, &replacements)),
    };

    if let Ok(root) = diagnostics_root(app) {
        if fs::create_dir_all(&root).is_ok() {
            let path = root.join(format!("{diagnostic_id}.json"));
            if let Ok(bytes) = serde_json::to_vec_pretty(&diagnostic) {
                let _ = fs::write(path, bytes);
                prune(&root);
            }
        }
    }
    diagnostic_id
}

pub fn user_error(diagnostic_id: &str, message: &str, technical_detail: &str) -> String {
    if cfg!(debug_assertions) {
        format!(
            "{message} [OCR-DIAG:{diagnostic_id}] DEV_OCR_DETAIL:{}",
            technical_detail.trim()
        )
    } else {
        format!("{message} [OCR-DIAG:{diagnostic_id}]")
    }
}

pub fn read_summary(app: &AppHandle, diagnostic_id: &str) -> Result<String, String> {
    validate_diagnostic_id(diagnostic_id)?;
    let path = diagnostics_root(app)?.join(format!("{diagnostic_id}.json"));
    let bytes = fs::read(&path).map_err(|_| "未找到该 OCR 诊断记录".to_owned())?;
    let value: StoredDiagnostic =
        serde_json::from_slice(&bytes).map_err(|_| "OCR 诊断记录格式无效".to_owned())?;
    Ok(render_summary(&value))
}

fn render_summary(value: &StoredDiagnostic) -> String {
    let mut lines = vec![
        format!("诊断编号：{}", value.diagnostic_id),
        format!("时间戳（UTC）：{}", value.timestamp_utc_seconds),
        format!("应用版本：{}", value.app_version),
        format!(
            "组件版本：{}",
            value.component_version.as_deref().unwrap_or("unknown")
        ),
        format!(
            "运行时来源：{}",
            value.runtime_source.as_deref().unwrap_or("unknown")
        ),
        format!("失败阶段：{}", value.stage),
        format!(
            "退出码：{}",
            value
                .exit_code
                .map(|item| item.to_string())
                .unwrap_or_else(|| "none".into())
        ),
        format!("超时：{}", value.timed_out),
        format!("已取消：{}", value.cancelled),
    ];
    if let Some(path) = &value.python_path {
        lines.push(format!("Python：{path}"));
    }
    if let Some(path) = &value.module_path {
        lines.push(format!("模块目录：{path}"));
    }
    if let Some(path) = &value.model_path {
        lines.push(format!("模型目录：{path}"));
    }
    if let Some(category) = &value.error_category {
        lines.push(format!("错误类别：{category}"));
    }
    if let Some(detail) = &value.detail {
        lines.push(format!("摘要：{detail}"));
    }
    if !value.stdout_tail.is_empty() {
        lines.push("stdout 尾部：".into());
        lines.extend(value.stdout_tail.iter().map(|line| format!("  {line}")));
    }
    if !value.stderr_tail.is_empty() {
        lines.push("stderr 尾部：".into());
        lines.extend(value.stderr_tail.iter().map(|line| format!("  {line}")));
    }
    lines.join("\n")
}

fn validate_diagnostic_id(value: &str) -> Result<(), String> {
    if value.len() > 80
        || value.is_empty()
        || !value
            .bytes()
            .all(|item| item.is_ascii_uppercase() || item.is_ascii_digit() || item == b'-')
    {
        return Err("OCR 诊断编号无效".into());
    }
    Ok(())
}

fn diagnostics_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位 OCR 诊断目录：{error}"))?
        .join(DIAGNOSTIC_DIRECTORY))
}

fn prune(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut files = entries
        .flatten()
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("json"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|(modified, _)| *modified);
    while files.len() > MAX_DIAGNOSTICS {
        let (_, path) = files.remove(0);
        let _ = fs::remove_file(path);
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn output_tail(bytes: &[u8], replacements: &[(String, String)]) -> Vec<String> {
    let decoded = String::from_utf8_lossy(bytes);
    let mut lines = decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(OUTPUT_TAIL_LINES)
        .map(|line| sanitize_output_line(line, replacements))
        .collect::<Vec<_>>();
    lines.reverse();
    lines
}

fn sanitize_output_line(value: &str, replacements: &[(String, String)]) -> String {
    let lowered = value.to_ascii_lowercase();
    if value.len() > 1000
        || [
            "\"courses\"",
            "\"sourceName\"",
            "\"rawText\"",
            "\"rec_texts\"",
            "\"tokenPreview\"",
            "\"teacher\"",
            "\"location\"",
        ]
        .iter()
        .any(|marker| lowered.contains(&marker.to_ascii_lowercase()))
    {
        return "[OCR payload line suppressed]".into();
    }
    sanitize_text(value, replacements)
}

fn redaction_replacements(runtime: Option<&RecognizerRuntime>) -> Vec<(String, String)> {
    let mut values = Vec::new();
    for (name, marker) in [
        ("USERPROFILE", "%USERPROFILE%"),
        ("LOCALAPPDATA", "%LOCALAPPDATA%"),
        ("APPDATA", "%APPDATA%"),
        ("TEMP", "%TEMP%"),
        ("TMP", "%TMP%"),
    ] {
        if let Some(value) = std::env::var_os(name) {
            let value = PathBuf::from(value).to_string_lossy().to_string();
            if !value.is_empty() {
                values.push((value, marker.into()));
            }
        }
    }
    if let Some(runtime) = runtime {
        if let Some(root) = runtime.component_root() {
            values.push((root.to_string_lossy().to_string(), "%OCR_ROOT%".into()));
        }
    }
    values.sort_by(|left, right| right.0.len().cmp(&left.0.len()));
    values
}

fn redact_path(path: &Path, replacements: &[(String, String)]) -> String {
    sanitize_text(&path.to_string_lossy(), replacements)
}

fn sanitize_text(value: &str, replacements: &[(String, String)]) -> String {
    let mut sanitized = value.replace('\0', "");
    for (from, to) in replacements {
        sanitized = replace_case_insensitive(&sanitized, from, to);
    }
    let users_pattern =
        Regex::new(r"(?i)[A-Z]:\\Users\\[^\\/\r\n]+").expect("static user path regex");
    sanitized = users_pattern
        .replace_all(&sanitized, "%USERPROFILE%")
        .into_owned();
    sanitized.chars().take(2000).collect()
}

fn replace_case_insensitive(source: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return source.to_owned();
    }
    let pattern = regex::RegexBuilder::new(&regex::escape(needle))
        .case_insensitive(true)
        .build();
    match pattern {
        Ok(pattern) => pattern
            .replace_all(source, |_captures: &regex::Captures<'_>| replacement)
            .into_owned(),
        Err(_) => source.replace(needle, replacement),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_windows_user_paths() {
        let text = sanitize_text(
            r"failed at C:\Users\alice\AppData\Local\Temp\secret.dll",
            &[],
        );
        assert!(!text.contains("alice"));
        assert!(text.contains("%USERPROFILE%"));
    }

    #[test]
    fn diagnostic_ids_reject_path_traversal() {
        assert!(validate_diagnostic_id("OCR-ABC-12").is_ok());
        assert!(validate_diagnostic_id("../OCR-ABC").is_err());
        assert!(validate_diagnostic_id("ocr-lowercase").is_err());
    }

    #[test]
    fn keeps_only_the_three_most_recent_diagnostics() {
        let root = std::env::temp_dir().join(format!(
            "course-widget-ocr-diagnostic-prune-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        for index in 0..5 {
            fs::write(root.join(format!("OCR-TEST-{index}.json")), b"{}").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        prune(&root);
        let remaining = fs::read_dir(&root).unwrap().flatten().count();
        assert_eq!(remaining, MAX_DIAGNOSTICS);
        let _ = fs::remove_dir_all(root);
    }
}
