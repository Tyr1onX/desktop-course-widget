use std::{
    env, fs,
    fs::File,
    path::{Path, PathBuf},
    process::{Child, ExitStatus, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{
    import_draft::{
        ImportCourseReview, ImportDraft, ImportFieldEvidence, ImportFieldKey, ImportReviewStatus,
        ImportSource,
    },
    ocr_component::{self, RecognizerRuntime},
    ocr_diagnostics::{self, DiagnosticEvidence},
};

const OCR_TIMEOUT: Duration = Duration::from_secs(10 * 60);
static RECOGNITION_RUNNING: AtomicBool = AtomicBool::new(false);
static CANCELLATION_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrStageEvent {
    stage: &'static str,
    title: &'static str,
    detail: &'static str,
}

pub(crate) struct RecognitionGuard;

pub(crate) fn begin_recognition() -> Result<RecognitionGuard, String> {
    if RECOGNITION_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("已有课表截图正在识别，请稍候或先取消当前识别".into());
    }
    CANCELLATION_REQUESTED.store(false, Ordering::SeqCst);
    Ok(RecognitionGuard)
}

pub(crate) fn cancel_recognition() -> bool {
    if !RECOGNITION_RUNNING.load(Ordering::SeqCst) {
        return false;
    }
    CANCELLATION_REQUESTED.store(true, Ordering::SeqCst);
    true
}

fn cancellation_requested() -> bool {
    CANCELLATION_REQUESTED.load(Ordering::SeqCst)
}

impl Drop for RecognitionGuard {
    fn drop(&mut self) {
        CANCELLATION_REQUESTED.store(false, Ordering::SeqCst);
        RECOGNITION_RUNNING.store(false, Ordering::SeqCst);
    }
}

struct TempOutput {
    path: PathBuf,
}

impl TempOutput {
    fn create() -> Result<Self, String> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("无法创建截图识别临时目录：{error}"))?
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "course-widget-screenshot-ocr-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path)
            .map_err(|error| format!("无法创建截图识别临时目录：{error}"))?;
        Ok(Self { path })
    }
}

impl Drop for TempOutput {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.path) {
            eprintln!("[screenshot-import] could not clean temporary output: {error}");
        }
    }
}

enum WaitResult {
    Exited(ExitStatus),
    TimedOut,
    Cancelled,
}

pub fn recognize_screenshot(app: &AppHandle, image_path: &Path) -> Result<ImportDraft, String> {
    validate_image_path(image_path)?;
    emit_stage(
        app,
        "checking-component",
        "正在检查本地识别组件…",
        "正在验证课刻自带的 Python、OCR 依赖和离线模型。",
    );

    let runtime = ocr_component::resolve_runtime(app)?;
    let output = TempOutput::create()?;
    let stdout_path = output.path.join("recognizer.stdout.log");
    let stderr_path = output.path.join("recognizer.stderr.log");
    let stage_path = output.path.join("recognizer-stage.json");
    let stdout = File::create(&stdout_path)
        .map_err(|error| format!("无法创建截图识别输出日志：{error}"))?;
    let stderr = File::create(&stderr_path)
        .map_err(|error| format!("无法创建截图识别错误日志：{error}"))?;

    emit_stage(
        app,
        "starting-recognizer",
        "正在启动本地识别器…",
        "只会使用课刻安装目录中的隔离运行时。",
    );
    let mut command = ocr_component::isolated_python_command(
        &runtime,
        "experiments.screenshot_import",
    )
    .map_err(|error| {
        failure(
            app,
            &runtime,
            "environment",
            "本地截图识别器启动失败。",
            error,
            None,
            Vec::new(),
            Vec::new(),
            false,
            false,
        )
    })?;
    command
        .env("COURSE_WIDGET_OCR_STAGE_FILE", &stage_path)
        .arg("recognize")
        .arg("--input")
        .arg(image_path)
        .arg("--output")
        .arg(&output.path)
        .arg("--engine")
        .arg("paddle")
        .arg("--repo-root")
        .arg(&runtime.module_root)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    let mut process = command.spawn().map_err(|error| {
        failure(
            app,
            &runtime,
            "spawn",
            "本地截图识别器启动失败。",
            format!("spawn failed: {error}"),
            None,
            Vec::new(),
            Vec::new(),
            false,
            false,
        )
    })?;

    emit_stage(
        app,
        "loading-models",
        "正在加载本地识别模型…",
        "首次加载可能需要较长时间，图片不会上传。",
    );
    let wait_result = wait_for_process(app, &mut process, OCR_TIMEOUT, &stage_path)
        .map_err(|error| {
            failure(
                app,
                &runtime,
                "wait",
                "本地截图识别器运行失败。",
                error,
                None,
                read_bytes(&stdout_path),
                read_bytes(&stderr_path),
                false,
                false,
            )
        })?;

    match wait_result {
        WaitResult::Cancelled => {
            return Err(failure(
                app,
                &runtime,
                "cancelled",
                "已取消截图识别。",
                "recognition cancelled by user".into(),
                None,
                read_bytes(&stdout_path),
                read_bytes(&stderr_path),
                false,
                true,
            ));
        }
        WaitResult::TimedOut => {
            return Err(failure(
                app,
                &runtime,
                "timeout",
                "课表截图识别超时，请尝试使用更清晰或尺寸更小的图片。",
                "recognition exceeded the ten minute safety timeout".into(),
                None,
                read_bytes(&stdout_path),
                read_bytes(&stderr_path),
                true,
                false,
            ));
        }
        WaitResult::Exited(status) if !status.success() => {
            let stderr = read_bytes(&stderr_path);
            let stdout = read_bytes(&stdout_path);
            let detail = compact_failure(&stderr, &stdout);
            return Err(failure(
                app,
                &runtime,
                "process-exit",
                "课表截图识别失败。",
                detail,
                status.code(),
                stdout,
                stderr,
                false,
                false,
            ));
        }
        WaitResult::Exited(_) => {}
    }

    emit_stage(
        app,
        "organizing-courses",
        "正在整理课程信息…",
        "正在组合课程名、周次、节次、地点和教师。",
    );
    let draft_path = output.path.join("draft.json");
    let raw = fs::read_to_string(&draft_path).map_err(|error| {
        failure(
            app,
            &runtime,
            "draft-read",
            "截图识别器未生成可用结果。",
            format!("draft.json read failed: {error}"),
            Some(0),
            read_bytes(&stdout_path),
            read_bytes(&stderr_path),
            false,
            false,
        )
    })?;
    let mut draft: ImportDraft = serde_json::from_str(&raw).map_err(|error| {
        failure(
            app,
            &runtime,
            "draft-parse",
            "截图识别结果格式无效。",
            format!("draft.json parse failed: {error}"),
            Some(0),
            read_bytes(&stdout_path),
            read_bytes(&stderr_path),
            false,
            false,
        )
    })?;

    validate_draft(app, &runtime, &draft, &stdout_path, &stderr_path)?;
    draft.source_name = image_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("已选择课表截图")
        .to_owned();
    enforce_manual_review(&mut draft);
    emit_stage(
        app,
        "review-ready",
        "正在生成复核结果…",
        "识别已完成，即将打开课程检查页面。",
    );
    Ok(draft)
}

fn validate_draft(
    app: &AppHandle,
    runtime: &RecognizerRuntime,
    draft: &ImportDraft,
    stdout_path: &Path,
    stderr_path: &Path,
) -> Result<(), String> {
    let detail = if draft.source != ImportSource::Image {
        Some("recognizer returned a non-image import source")
    } else if draft.image_source.as_ref().is_none_or(|image| {
        image.width == 0 || image.height == 0
    }) {
        Some("recognizer returned invalid image dimensions")
    } else if draft.courses.is_empty() {
        Some("recognizer returned no courses")
    } else {
        None
    };
    if let Some(detail) = detail {
        return Err(failure(
            app,
            runtime,
            "draft-validation",
            "没有从这张图片中识别到可用课程。",
            detail.into(),
            Some(0),
            read_bytes(stdout_path),
            read_bytes(stderr_path),
            false,
            false,
        ));
    }
    Ok(())
}

fn wait_for_process(
    app: &AppHandle,
    process: &mut Child,
    timeout: Duration,
    stage_path: &Path,
) -> Result<WaitResult, String> {
    let deadline = Instant::now() + timeout;
    let mut recognition_stage_reported = false;
    loop {
        if cancellation_requested() {
            let _ = process.kill();
            let _ = process.wait();
            return Ok(WaitResult::Cancelled);
        }
        if !recognition_stage_reported && stage_path.is_file() {
            recognition_stage_reported = true;
            emit_stage(
                app,
                "recognizing-text",
                "正在识别课表文字…",
                "模型已加载，正在分析星期、节次和课程内容。",
            );
        }
        if let Some(status) = process
            .try_wait()
            .map_err(|error| format!("无法读取截图识别器状态：{error}"))?
        {
            return Ok(WaitResult::Exited(status));
        }
        if Instant::now() >= deadline {
            let _ = process.kill();
            let _ = process.wait();
            return Ok(WaitResult::TimedOut);
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn emit_stage(app: &AppHandle, stage: &'static str, title: &'static str, detail: &'static str) {
    let _ = app.emit(
        "screenshot-ocr-stage",
        OcrStageEvent {
            stage,
            title,
            detail,
        },
    );
}

#[allow(clippy::too_many_arguments)]
fn failure(
    app: &AppHandle,
    runtime: &RecognizerRuntime,
    stage: &str,
    user_message: &str,
    technical_detail: String,
    exit_code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
    cancelled: bool,
) -> String {
    let diagnostic_id = ocr_diagnostics::record(
        app,
        Some(runtime),
        DiagnosticEvidence {
            stage: stage.into(),
            exit_code,
            stdout,
            stderr,
            timed_out,
            cancelled,
            error_category: Some(stage.into()),
            detail: Some(technical_detail.clone()),
        },
    );
    ocr_diagnostics::user_error(&diagnostic_id, user_message, &technical_detail)
}

fn read_bytes(path: &Path) -> Vec<u8> {
    fs::read(path).unwrap_or_default()
}

fn validate_image_path(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("所选课表截图不存在或无法读取".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg") {
        return Err("仅支持 PNG、JPG、JPEG 课表截图".into());
    }
    Ok(())
}

fn enforce_manual_review(draft: &mut ImportDraft) {
    for course in &mut draft.courses {
        let review = course.review.get_or_insert_with(ImportCourseReview::default);
        for field in [
            ImportFieldKey::Name,
            ImportFieldKey::Teacher,
            ImportFieldKey::Location,
            ImportFieldKey::Weeks,
            ImportFieldKey::Parity,
        ] {
            let missing = match field {
                ImportFieldKey::Name => course.name.trim().is_empty(),
                ImportFieldKey::Teacher => course
                    .teacher
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty()),
                ImportFieldKey::Location => course
                    .location
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty()),
                ImportFieldKey::Weeks => course.weeks.is_empty(),
                ImportFieldKey::Parity => course.parity.trim().is_empty(),
                _ => false,
            };
            let status = if missing {
                ImportReviewStatus::Missing
            } else {
                ImportReviewStatus::Review
            };
            if let Some(evidence) = review
                .fields
                .iter_mut()
                .find(|evidence| evidence.field == field)
            {
                evidence.status = status;
                if evidence.reason.is_none() {
                    evidence.reason = Some("截图 OCR 字段需人工确认".into());
                }
            } else {
                review.fields.push(ImportFieldEvidence {
                    field,
                    status,
                    confidence: None,
                    raw_text: None,
                    source_box: None,
                    reason: Some("截图 OCR 字段需人工确认".into()),
                });
            }
        }
    }
}

fn compact_failure(stderr: &[u8], stdout: &[u8]) -> String {
    let text = if stderr.is_empty() { stdout } else { stderr };
    let decoded = String::from_utf8_lossy(text);
    let mut lines = decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(8)
        .collect::<Vec<_>>();
    lines.reverse();
    let joined = lines.join(" · ");
    if joined.is_empty() {
        "识别器未提供错误详情".into()
    } else {
        joined.chars().take(1000).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import_draft::{ImportCourse, ImportDraftSummary, ImportImageSource};

    fn sample_draft() -> ImportDraft {
        ImportDraft {
            schema_version: 1,
            source: ImportSource::Image,
            source_name: "sample.png".into(),
            suggested_name: "示例课表".into(),
            detected_term_text: None,
            summary: ImportDraftSummary {
                arrangements: 1,
                highest_week: 16,
                location_count: 0,
            },
            warnings: vec![],
            courses: vec![ImportCourse {
                code: None,
                name: "通信原理".into(),
                teacher: None,
                weekday: 1,
                start_section: 1,
                end_section: 2,
                weeks: (1..=16).collect(),
                parity: "all".into(),
                location: None,
                review: None,
            }],
            image_source: Some(ImportImageSource {
                width: 1000,
                height: 1600,
                weekday_columns: Some(7),
                section_rows: Some(12),
                recognizer_version: Some("test".into()),
            }),
        }
    }

    #[test]
    fn forces_ocr_text_fields_back_to_review() {
        let mut draft = sample_draft();
        enforce_manual_review(&mut draft);
        let fields = &draft.courses[0].review.as_ref().unwrap().fields;
        assert_eq!(
            fields
                .iter()
                .find(|item| item.field == ImportFieldKey::Name)
                .unwrap()
                .status,
            ImportReviewStatus::Review
        );
        assert_eq!(
            fields
                .iter()
                .find(|item| item.field == ImportFieldKey::Teacher)
                .unwrap()
                .status,
            ImportReviewStatus::Missing
        );
    }

    #[test]
    fn failure_output_is_bounded_and_prefers_stderr() {
        let detail = compact_failure(b"first\nsecond\nthird\nfourth\nfifth\n", b"ignored");
        assert_eq!(detail, "first · second · third · fourth · fifth");
    }

    #[test]
    fn recognition_guard_blocks_parallel_runs_and_supports_cancel() {
        let guard = begin_recognition().unwrap();
        assert!(begin_recognition().is_err());
        assert!(cancel_recognition());
        assert!(cancellation_requested());
        drop(guard);
        assert!(!cancel_recognition());
        assert!(!cancellation_requested());
        drop(begin_recognition().unwrap());
    }

    #[test]
    fn rejects_unsupported_image_extensions() {
        let path = env::temp_dir().join("course-widget-import-test.gif");
        fs::write(&path, b"test").unwrap();
        let result = validate_image_path(&path);
        let _ = fs::remove_file(path);
        assert!(result.is_err());
    }
}
