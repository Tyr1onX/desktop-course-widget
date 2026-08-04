from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src-tauri/src/native_ocr.rs",
    """    let mut draft = tokens_to_draft(
        image_path,
        original_width,
        original_height,
        working.width(),
        working.height(),
        &tokens,
    )?;
    draft.warnings.push(format!(
        \"本地识别耗时：读图 {decode_ms} ms，引擎准备 {engine_ms} ms，文字识别 {recognition_ms} ms\"
    ));
    Ok(draft)
""",
    """    let draft = tokens_to_draft(
        image_path,
        original_width,
        original_height,
        working.width(),
        working.height(),
        &tokens,
    )?;
    eprintln!(
        \"[native-ocr] decode_ms={decode_ms} engine_ms={engine_ms} recognition_ms={recognition_ms} courses={}\",
        draft.courses.len()
    );
    Ok(draft)
""",
)
replace_once(
    "src-tauri/src/native_ocr.rs",
    """    let bundled = resource_dir.join(\"ocr-native\");
    if bundled.is_dir() {
        return Ok(bundled);
    }
    Err(\"当前安装包没有包含本地文字识别模型\".into())
""",
    """    for bundled in [
        resource_dir.join(\"ocr-native\"),
        resource_dir.join(\"resources/ocr-native\"),
    ] {
        if bundled.is_dir() {
            return Ok(bundled);
        }
    }
    Err(\"当前安装包没有包含本地文字识别模型\".into())
""",
)

replace_once(
    "src-tauri/src/lib.rs",
    """use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
""",
    """use std::{
    env, fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
""",
)

smoke_support = r'''
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeOcrSmokeRun {
    elapsed_ms: u128,
    course_count: usize,
    names: Vec<String>,
    warnings: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeOcrSmokeReport {
    ok: bool,
    runs: Vec<NativeOcrSmokeRun>,
    error: Option<String>,
}

fn native_ocr_smoke_request() -> Option<(PathBuf, PathBuf, usize)> {
    let image = env::var_os("COURSE_WIDGET_NATIVE_OCR_SMOKE_IMAGE").map(PathBuf::from)?;
    let result = env::var_os("COURSE_WIDGET_NATIVE_OCR_SMOKE_RESULT").map(PathBuf::from)?;
    let runs = env::var("COURSE_WIDGET_NATIVE_OCR_SMOKE_RUNS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(2)
        .clamp(1, 4);
    Some((image, result, runs))
}

fn schedule_native_ocr_smoke(app: AppHandle, image: PathBuf, result: PathBuf, runs: usize) {
    std::thread::spawn(move || {
        let mut completed = Vec::new();
        let mut failure = None;
        for _ in 0..runs {
            let started = Instant::now();
            match screenshot_import::recognize_screenshot(&app, &image) {
                Ok(draft) => completed.push(NativeOcrSmokeRun {
                    elapsed_ms: started.elapsed().as_millis(),
                    course_count: draft.courses.len(),
                    names: draft.courses.iter().map(|course| course.name.clone()).collect(),
                    warnings: draft.warnings,
                }),
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
        let report = NativeOcrSmokeReport {
            ok: failure.is_none() && completed.len() == runs,
            runs: completed,
            error: failure,
        };
        let write_result = (|| -> Result<(), String> {
            if let Some(parent) = result.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("could not create native OCR smoke directory: {error}"))?;
            }
            let rendered = serde_json::to_vec_pretty(&report)
                .map_err(|error| format!("could not serialize native OCR smoke report: {error}"))?;
            fs::write(&result, rendered)
                .map_err(|error| format!("could not write native OCR smoke report: {error}"))
        })();
        let write_ok = match write_result {
            Ok(()) => true,
            Err(error) => {
                eprintln!("[native-ocr-smoke] {error}");
                false
            }
        };
        app.exit(if report.ok && write_ok { 0 } else { 1 });
    });
}

'''
replace_once(
    "src-tauri/src/lib.rs",
    "fn schedule_startup_safety_fallback(app: &tauri::App) {",
    smoke_support + "fn schedule_startup_safety_fallback(app: &tauri::App) {",
)
replace_once(
    "src-tauri/src/lib.rs",
    """        .plugin(schedule_catalog::init())
        .setup(|app| {
            if let Err(error) = data_transaction::recover_pending(app.handle()) {
""",
    """        .plugin(schedule_catalog::init())
        .setup(|app| {
            if let Some((image, result, runs)) = native_ocr_smoke_request() {
                schedule_native_ocr_smoke(app.handle().clone(), image, result, runs);
                return Ok(());
            }
            if let Err(error) = data_transaction::recover_pending(app.handle()) {
""",
)
