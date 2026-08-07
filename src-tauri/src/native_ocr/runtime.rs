use std::{
    cmp::Ordering,
    path::{Path, PathBuf},
    time::Instant,
};

use image::DynamicImage;
use ocr_rs::{DetOptions, OcrEngine, OcrEngineConfig};
use regex::Regex;

use crate::import_draft::{
    ImportCourse, ImportCourseReview, ImportDraft, ImportDraftSummary, ImportFieldEvidence,
    ImportFieldKey, ImportImageSource, ImportReviewStatus, ImportSource, NormalizedImageBox,
};

const MAX_IMAGE_SIDE: u32 = 1600;
const DEFAULT_LAST_WEEK: u8 = 16;
const DEFAULT_SECTION_COUNT: u8 = 12;
const RECOGNIZER_VERSION: &str = "ocr-rs-mnn-ppocrv5-mobile-v6";

#[derive(Debug, Clone)]
struct Token {
    text: String,
    parts: Vec<String>,
    lines: Vec<String>,
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
        let mut lines = value
            .lines()
            .map(compact_text)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>();
        if lines.is_empty() {
            lines.push(text.clone());
        }
        // Ordinary spaces are typography, not semantic field boundaries. Keep one
        // logical part per actual OCR line so English and mixed-language titles are
        // not reduced to their first whitespace-delimited word.
        let parts = lines.clone();
        Some(Self {
            text,
            parts,
            lines,
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
    metadata_text: String,
}

#[derive(Debug, Clone)]
struct WeekdayHeader {
    weekday: u8,
    center_x: f32,
    bottom: f32,
}

pub fn recognize_screenshot(image_path: &Path) -> Result<ImportDraft, String> {
    let total_started = Instant::now();
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
    let original =
        image::open(image_path).map_err(|error| format!("无法读取课表截图：{error}"))?;
    let original_width = original.width();
    let original_height = original.height();
    let working = adaptive_working_image(&original);
    let decode_ms = decode_started.elapsed().as_millis();

    let logical_processors = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4);
    let threads = (logical_processors / 2).clamp(2, 8) as i32;
    let detector_max_side = detector_max_side_for_dimensions(original_width, original_height);
    let config = OcrEngineConfig::fast()
        .with_threads(threads)
        .with_det_options(DetOptions::fast().with_max_side_len(detector_max_side));
    let engine_started = Instant::now();
    let engine = OcrEngine::new(&det_model, &rec_model, &charset, Some(config))
        .map_err(|error| format!("无法初始化本地文字识别引擎：{error}"))?;
    let engine_init_ms = engine_started.elapsed().as_millis();

    let recognition_started = Instant::now();
    let results = engine
        .recognize(&working)
        .map_err(|error| format!("本地课表文字识别失败：{error}"))?;
    let recognition_ms = recognition_started.elapsed().as_millis();

    let mut spacing_candidates = std::collections::HashMap::new();
    let raw_tokens = results
        .into_iter()
        .filter_map(|result| {
            for line in result.text.lines() {
                if let Some((compact, display)) = normalized_ascii_spacing(line) {
                    spacing_candidates.entry(compact).or_insert(display);
                }
            }
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
    if raw_tokens.is_empty() {
        return Err("没有从图片中识别到文字，请确认截图清晰且包含完整课表".into());
    }

    let parsing_started = Instant::now();
    let tokens = expand_multiline_tokens(raw_tokens);
    let mut draft = tokens_to_draft(
        image_path,
        original_width,
        original_height,
        working.width(),
        working.height(),
        &tokens,
    )?;
    restore_ascii_course_spacing(&mut draft, &spacing_candidates);
    let parsing_ms = parsing_started.elapsed().as_millis();
    let secondary_ocr_ms = 0_u128;
    let total_ms = total_started.elapsed().as_millis();

    eprintln!(
        "[native-ocr] decode_ms={decode_ms} engine_init_ms={engine_init_ms} recognition_ms={recognition_ms} parsing_ms={parsing_ms} secondary_ocr_ms={secondary_ocr_ms} total_ms={total_ms} tokens={} courses={} detector_max_side={} working={}x{} source={}x{}",
        tokens.len(),
        draft.courses.len(),
        detector_max_side,
        working.width(),
        working.height(),
        original_width,
        original_height
    );
    Ok(draft)
}

fn restore_ascii_course_spacing(
    draft: &mut ImportDraft,
    spacing_candidates: &std::collections::HashMap<String, String>,
) {
    for course in &mut draft.courses {
        let key = compact_text(&course.name);
        if let Some(display) = spacing_candidates.get(&key) {
            course.name = display.clone();
        }
    }
}

fn tokens_to_draft(
    image_path: &Path,
    original_width: u32,
    original_height: u32,
    working_width: u32,
    working_height: u32,
    tokens: &[Token],
) -> Result<ImportDraft, String> {
    let headers = structured_weekday_headers(tokens, working_width, working_height);
    if headers.len() < 3 {
        return Err(format!(
            "识别到了 {} 个文字块，但只找到 {} 个星期标题；请使用包含完整星期栏的课表截图",
            tokens.len(),
            headers.len()
        ));
    }

    let detected_sections = structured_section_markers(tokens, &headers, working_width);
    let (sections, sections_inferred) = if detected_sections.len() >= 2 {
        (detected_sections, false)
    } else {
        (
            infer_section_markers(tokens, &headers, working_height),
            true,
        )
    };
    let content_bottom = structured_timetable_content_bottom(
        tokens,
        &sections,
        &headers,
        working_height,
        sections_inferred,
    );
    let table_tokens = tokens
        .iter()
        .filter(|token| token.center_y() <= content_bottom)
        .cloned()
        .collect::<Vec<_>>();

    let anchors = structured_course_anchors(&table_tokens);
    let (anchored_courses, mut warnings) = anchor_courses(
        &table_tokens,
        &anchors,
        &headers,
        working_width,
        working_height,
    );
    let fallback = if should_use_fallback(sections_inferred, anchors.len()) {
        fallback_courses(
            &table_tokens,
            &headers,
            &sections,
            working_width,
            working_height,
        )
    } else {
        Vec::new()
    };
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
                && candidate
                    .teacher
                    .as_deref()
                    .is_some_and(|value| !value.is_empty())
            {
                existing.teacher = candidate.teacher;
            }
            if existing.location.as_deref().is_none_or(str::is_empty)
                && candidate
                    .location
                    .as_deref()
                    .is_some_and(|value| !value.is_empty())
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

fn should_use_fallback(_sections_inferred: bool, anchor_count: usize) -> bool {
    // Once a timetable yields several explicit weekday/section anchors, position-only
    // fallback creates duplicate and fake courses when row markers are inferred.
    anchor_count < 3
}
