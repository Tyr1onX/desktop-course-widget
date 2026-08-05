use std::path::Path;

use crate::import_draft::ImportDraft;

pub const RELEASE_UNAVAILABLE_REASON: &str =
    "当前安装包未包含截图识别运行时；请使用 Excel 导入";

#[cfg(debug_assertions)]
pub fn recognize_screenshot(image_path: &Path) -> Result<ImportDraft, String> {
    development_runtime::recognize_screenshot(image_path)
}

#[cfg(not(debug_assertions))]
pub fn recognize_screenshot(_image_path: &Path) -> Result<ImportDraft, String> {
    Err(RELEASE_UNAVAILABLE_REASON.into())
}

#[cfg(debug_assertions)]
pub(crate) fn development_runtime_status() -> Result<(), String> {
    development_runtime::runtime_status()
}

#[cfg(debug_assertions)]
mod development_runtime {
    use std::{
        env, fs,
        fs::File,
        path::{Path, PathBuf},
        process::{Child, Command, ExitStatus, Stdio},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    use crate::import_draft::{
        ImportCourseReview, ImportDraft, ImportFieldEvidence, ImportFieldKey, ImportReviewStatus,
        ImportSource,
    };

    const OCR_PYTHON_ENV: &str = "COURSE_WIDGET_OCR_PYTHON";
    const OCR_REPO_ROOT_ENV: &str = "COURSE_WIDGET_OCR_REPO_ROOT";
    const OCR_TIMEOUT: Duration = Duration::from_secs(10 * 60);

    struct RecognizerRuntime {
        python: PathBuf,
        repo_root: PathBuf,
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

    pub(super) fn runtime_status() -> Result<(), String> {
        resolve_runtime().map(|_| ())
    }

    pub(super) fn recognize_screenshot(image_path: &Path) -> Result<ImportDraft, String> {
        validate_image_path(image_path)?;
        let runtime = resolve_runtime()?;
        let output = TempOutput::create()?;
        let stdout_path = output.path.join("recognizer.stdout.log");
        let stderr_path = output.path.join("recognizer.stderr.log");
        let stdout = File::create(&stdout_path)
            .map_err(|error| format!("无法创建截图识别输出日志：{error}"))?;
        let stderr = File::create(&stderr_path)
            .map_err(|error| format!("无法创建截图识别错误日志：{error}"))?;

        let mut process = Command::new(&runtime.python)
            .current_dir(&runtime.repo_root)
            .arg("-m")
            .arg("experiments.screenshot_import")
            .arg("recognize")
            .arg("--input")
            .arg(image_path)
            .arg("--output")
            .arg(&output.path)
            .arg("--engine")
            .arg("paddle")
            .arg("--repo-root")
            .arg(&runtime.repo_root)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| format!("无法启动本地截图识别器：{error}"))?;

        let status = wait_for_process(&mut process, OCR_TIMEOUT)?;
        if !status.success() {
            let stderr = fs::read(&stderr_path).unwrap_or_default();
            let stdout = fs::read(&stdout_path).unwrap_or_default();
            let detail = compact_failure(&stderr, &stdout);
            return Err(format!("课表截图识别失败：{detail}"));
        }

        let draft_path = output.path.join("draft.json");
        let raw = fs::read_to_string(&draft_path)
            .map_err(|error| format!("截图识别器未生成可用草稿：{error}"))?;
        let mut draft: ImportDraft = serde_json::from_str(&raw)
            .map_err(|error| format!("截图识别草稿格式无效：{error}"))?;

        if draft.source != ImportSource::Image {
            return Err("截图识别器返回了错误的导入来源类型".into());
        }
        let image_source = draft
            .image_source
            .as_ref()
            .ok_or_else(|| "截图识别器未返回图片尺寸信息".to_owned())?;
        if image_source.width == 0 || image_source.height == 0 {
            return Err("截图识别器返回的图片尺寸无效".into());
        }
        if draft.courses.is_empty() {
            return Err("没有从主课表区域识别到课程安排".into());
        }

        draft.source_name = image_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("已选择课表截图")
            .to_owned();
        enforce_manual_review(&mut draft);
        Ok(draft)
    }

    fn wait_for_process(process: &mut Child, timeout: Duration) -> Result<ExitStatus, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = process
                .try_wait()
                .map_err(|error| format!("无法读取截图识别器状态：{error}"))?
            {
                return Ok(status);
            }
            if Instant::now() >= deadline {
                let _ = process.kill();
                let _ = process.wait();
                return Err("课表截图识别超时，请检查图片大小或本地 OCR 运行环境后重试".into());
            }
            thread::sleep(Duration::from_millis(200));
        }
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

    fn resolve_runtime() -> Result<RecognizerRuntime, String> {
        let configured_python = env::var_os(OCR_PYTHON_ENV).map(PathBuf::from);
        let configured_root = env::var_os(OCR_REPO_ROOT_ENV).map(PathBuf::from);
        match (configured_python, configured_root) {
            (Some(python), Some(repo_root)) => {
                if !python.is_file() {
                    return Err(format!(
                        "环境变量 {OCR_PYTHON_ENV} 指向的 OCR Python 不存在"
                    ));
                }
                if !repo_root.join("experiments/screenshot_import").is_dir() {
                    return Err(format!(
                        "环境变量 {OCR_REPO_ROOT_ENV} 未指向有效的开发仓库"
                    ));
                }
                return Ok(RecognizerRuntime { python, repo_root });
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(format!(
                    "开发态截图识别需要同时设置 {OCR_PYTHON_ENV} 与 {OCR_REPO_ROOT_ENV}"
                ));
            }
            (None, None) => {}
        }

        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "无法定位截图识别开发仓库".to_owned())?
            .to_path_buf();
        let candidates = [
            repo_root.join(".tmp/screenshot-ocr-venv/Scripts/python.exe"),
            repo_root.join(".tmp/screenshot-ocr-venv/bin/python"),
            repo_root.join(".venv/Scripts/python.exe"),
            repo_root.join(".venv/bin/python"),
        ];
        let python = candidates
            .into_iter()
            .find(|candidate| candidate.is_file())
            .ok_or_else(|| {
                "未找到仓库内 OCR 开发运行时。请先准备 .tmp/screenshot-ocr-venv，不能依赖系统 Python。"
                    .to_owned()
            })?;
        Ok(RecognizerRuntime { python, repo_root })
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
            .take(4)
            .collect::<Vec<_>>();
        lines.reverse();
        let joined = lines.join(" · ");
        if joined.is_empty() {
            "识别器未提供错误详情".into()
        } else {
            joined.chars().take(600).collect()
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
            assert_eq!(
                fields
                    .iter()
                    .find(|item| item.field == ImportFieldKey::Location)
                    .unwrap()
                    .status,
                ImportReviewStatus::Missing
            );
        }

        #[test]
        fn failure_output_is_bounded_and_prefers_stderr() {
            let detail = compact_failure(b"first\nsecond\nthird\nfourth\nfifth\n", b"ignored");
            assert_eq!(detail, "second · third · fourth · fifth");
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
}
