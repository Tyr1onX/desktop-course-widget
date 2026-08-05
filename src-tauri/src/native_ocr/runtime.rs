use std::{
    cmp::Ordering,
    path::{Path, PathBuf},
    time::Instant,
};

use image::DynamicImage;
use ocr_rs::{OcrEngine, OcrEngineConfig};
use regex::Regex;
use crate::import_draft::{
    ImportCourse, ImportCourseReview, ImportDraft, ImportDraftSummary, ImportFieldEvidence,
    ImportFieldKey, ImportImageSource, ImportReviewStatus, ImportSource, NormalizedImageBox,
};

const MAX_IMAGE_SIDE: u32 = 1600;
const DEFAULT_LAST_WEEK: u8 = 16;
const DEFAULT_SECTION_COUNT: u8 = 12;
const RECOGNIZER_VERSION: &str = "ocr-rs-mnn-ppocrv5-mobile-v2";

#[derive(Debug, Clone)]
struct Token {
    text: String,
    parts: Vec<String>,
    confidence: f32,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
}

impl Token {
    fn from_text(
        value: &str,
        confidence: f32,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
    ) -> Option<Self> {
        let text = compact_text(value);
        if text.is_empty() {
            return None;
        }
        let mut parts = value
            .split_whitespace()
            .map(compact_text)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.is_empty() {
            parts.push(text.clone());
        }
        Some(Self {
            text,
            parts,
            confidence: confidence.clamp(0.0, 1.0),
            left,
            top,
            width,
            height,
        })
    }

    fn right(&self) -> f32 {
        self.left + self.width
    }

    fn bottom(&self) -> f32 {
        self.top + self.height
    }

    fn center_x(&self) -> f32 {
        self.left + self.width / 2.0
    }

    fn center_y(&self) -> f32 {
        self.top + self.height / 2.0
    }
}

#[derive(Debug, Clone)]
struct CourseAnchor {
    token_index: usize,
    weekday: u8,
    start_section: u8,
    end_section: u8,
    weeks: Vec<u8>,
    parity: String,
    used_default_weeks: bool,
}

#[derive(Debug, Clone)]
struct WeekdayHeader {
    weekday: u8,
    center_x: f32,
    bottom: f32,
}

pub fn recognize_screenshot(image_path: &Path) -> Result<ImportDraft, String> {
    validate_image_path(image_path)?;
    let model_root = resolve_model_root()?;
    let det_model = model_root.join("PP-OCRv5_mobile_det_fp16.mnn");
    let rec_model = model_root.join("PP-OCRv5_mobile_rec_fp16.mnn");
    let charset = model_root.join("ppocr_keys_v5.txt");
    for path in [&det_model, &rec_model, &charset] {
        if !path.is_file() {
            return Err(format!(
                "本地文字识别模型缺失：{}",
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("model")
            ));
        }
    }

    let decode_started = Instant::now();
    let original = image::open(image_path).map_err(|error| format!("无法读取课表截图：{error}"))?;
    let original_width = original.width();
    let original_height = original.height();
    let working = bounded_image(original, MAX_IMAGE_SIDE);
    let decode_ms = decode_started.elapsed().as_millis();

    let logical_processors = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4);
    let threads = (logical_processors / 2).clamp(2, 8) as i32;
    let config = OcrEngineConfig::fast().with_threads(threads);
    let engine_started = Instant::now();
    let engine = OcrEngine::new(&det_model, &rec_model, &charset, Some(config))
        .map_err(|error| format!("无法初始化本地文字识别引擎：{error}"))?;
    let engine_ms = engine_started.elapsed().as_millis();

    let recognition_started = Instant::now();
    let results = engine
        .recognize(&working)
        .map_err(|error| format!("本地课表文字识别失败：{error}"))?;
    let recognition_ms = recognition_started.elapsed().as_millis();
    let tokens = results
        .into_iter()
        .filter_map(|result| {
            Token::from_text(
                &result.text,
                result.confidence,
                result.bbox.rect.left().max(0) as f32,
                result.bbox.rect.top().max(0) as f32,
                result.bbox.rect.width() as f32,
                result.bbox.rect.height() as f32,
            )
        })
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return Err("没有从图片中识别到文字，请确认截图清晰且包含完整课表".into());
    }

    let draft = tokens_to_draft(
        image_path,
        original_width,
        original_height,
        working.width(),
        working.height(),
        &tokens,
    )?;
    eprintln!(
        "[native-ocr] decode_ms={decode_ms} engine_ms={engine_ms} recognition_ms={recognition_ms} tokens={} courses={}",
        tokens.len(),
        draft.courses.len()
    );
    Ok(draft)
}

fn tokens_to_draft(
    image_path: &Path,
    original_width: u32,
    original_height: u32,
    working_width: u32,
    working_height: u32,
    tokens: &[Token],
) -> Result<ImportDraft, String> {
    let headers = weekday_headers(tokens);
    if headers.len() < 3 {
        return Err(format!(
            "识别到了 {} 个文字块，但只找到 {} 个星期标题；请使用包含完整星期栏的课表截图",
            tokens.len(),
            headers.len()
        ));
    }

    let detected_sections = section_markers(tokens, working_width);
    let (sections, sections_inferred) = if detected_sections.len() >= 2 {
        (detected_sections, false)
    } else {
        (
            infer_section_markers(tokens, &headers, working_height),
            true,
        )
    };
    let anchors = course_anchors(tokens);
    let (anchored_courses, mut warnings) = anchor_courses(
        tokens,
        &anchors,
        &headers,
        working_width,
        working_height,
    );
    let fallback = fallback_courses(
        tokens,
        &headers,
        &sections,
        working_width,
        working_height,
    );
    let fallback_count = fallback.len();
    let mut courses = merge_course_candidates(anchored_courses, fallback);

    if fallback_count > 0 && anchors.len() < courses.len() {
        warnings.push("部分课程通过课表卡片位置恢复，请在创建前核对摘要".into());
    }
    if sections_inferred && !courses.is_empty() {
        warnings.push("没有可靠识别到左侧节次，少数课程节次可能需要核对".into());
    }
    if courses.is_empty() {
        return Err(format!(
            "识别到了 {} 个文字块和 {} 个星期栏，但没有整理出课程（节次标记 {} 个，课程锚点 {} 个）",
            tokens.len(),
            headers.len(),
            sections.len(),
            anchors.len()
        ));
    }

    courses.sort_by(|left, right| {
        left.weekday
            .cmp(&right.weekday)
            .then(left.start_section.cmp(&right.start_section))
            .then(left.end_section.cmp(&right.end_section))
            .then(left.name.cmp(&right.name))
            .then(left.weeks.first().cmp(&right.weeks.first()))
    });
    courses.dedup_by(|left, right| same_course_identity(left, right));

    let highest_week = courses
        .iter()
        .flat_map(|course| course.weeks.iter().copied())
        .max()
        .unwrap_or(DEFAULT_LAST_WEEK);
    let location_count = courses
        .iter()
        .filter(|course| {
            course
                .location
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        })
        .count();
    warnings.dedup();
    let source_name = image_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("已选择课表截图")
        .to_owned();
    let suggested_name = image_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("截图课表")
        .to_owned();

    Ok(ImportDraft {
        schema_version: 1,
        source: ImportSource::Image,
        source_name,
        suggested_name,
        detected_term_text: None,
        summary: ImportDraftSummary {
            arrangements: courses.len(),
            highest_week,
            location_count,
        },
        warnings,
        courses,
        image_source: Some(ImportImageSource {
            width: original_width,
            height: original_height,
            weekday_columns: Some(headers.len().min(7) as u8),
            section_rows: sections.iter().map(|(section, _)| *section).max(),
            recognizer_version: Some(RECOGNIZER_VERSION.into()),
        }),
    })
}

fn merge_course_candidates(
    anchored: Vec<ImportCourse>,
    fallback: Vec<ImportCourse>,
) -> Vec<ImportCourse> {
    let mut courses = anchored;
    for candidate in fallback {
        if let Some(existing) = courses
            .iter_mut()
            .find(|existing| same_course_identity(existing, &candidate))
        {
            if existing.teacher.as_deref().is_none_or(str::is_empty)
                && candidate.teacher.as_deref().is_some_and(|value| !value.is_empty())
            {
                existing.teacher = candidate.teacher;
            }
            if existing.location.as_deref().is_none_or(str::is_empty)
                && candidate.location.as_deref().is_some_and(|value| !value.is_empty())
            {
                existing.location = candidate.location;
            }
        } else {
            courses.push(candidate);
        }
    }
    courses
}

fn same_course_identity(left: &ImportCourse, right: &ImportCourse) -> bool {
    left.weekday == right.weekday
        && left.start_section == right.start_section
        && left.end_section == right.end_section
        && left.name == right.name
        && left.weeks == right.weeks
        && left.parity == right.parity
}
