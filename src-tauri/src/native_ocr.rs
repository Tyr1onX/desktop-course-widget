use std::{cmp::Ordering, path::{Path, PathBuf}, time::Instant};

use image::DynamicImage;
use ocr_rs::{OcrEngine, OcrEngineConfig};
use regex::Regex;
use tauri::{AppHandle, Manager};

use crate::import_draft::{
    ImportCourse, ImportCourseReview, ImportDraft, ImportDraftSummary, ImportFieldEvidence,
    ImportFieldKey, ImportImageSource, ImportReviewStatus, ImportSource, NormalizedImageBox,
};

const MAX_IMAGE_SIDE: u32 = 1600;
const DEFAULT_LAST_WEEK: u8 = 16;
const RECOGNIZER_VERSION: &str = "ocr-rs-mnn-ppocrv5-mobile-v1";

#[derive(Debug, Clone)]
struct Token {
    text: String,
    confidence: f32,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
}

impl Token {
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

pub fn recognize_screenshot(app: &AppHandle, image_path: &Path) -> Result<ImportDraft, String> {
    validate_image_path(image_path)?;
    let model_root = resolve_model_root(app)?;
    let det_model = model_root.join("PP-OCRv5_mobile_det_fp16.mnn");
    let rec_model = model_root.join("PP-OCRv5_mobile_rec_fp16.mnn");
    let charset = model_root.join("ppocr_keys_v5.txt");
    for path in [&det_model, &rec_model, &charset] {
        if !path.is_file() {
            return Err(format!("本地文字识别模型缺失：{}", path.file_name().and_then(|name| name.to_str()).unwrap_or("model")));
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
            let text = compact_text(&result.text);
            if text.is_empty() {
                return None;
            }
            Some(Token {
                text,
                confidence: result.confidence.clamp(0.0, 1.0),
                left: result.bbox.rect.left().max(0) as f32,
                top: result.bbox.rect.top().max(0) as f32,
                width: result.bbox.rect.width() as f32,
                height: result.bbox.rect.height() as f32,
            })
        })
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return Err("没有从图片中识别到文字，请确认截图清晰且包含完整课表".into());
    }

    let mut draft = tokens_to_draft(
        image_path,
        original_width,
        original_height,
        working.width(),
        working.height(),
        &tokens,
    )?;
    draft.warnings.push(format!(
        "本地识别耗时：读图 {decode_ms} ms，引擎准备 {engine_ms} ms，文字识别 {recognition_ms} ms"
    ));
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
        return Err("没有识别到足够的星期标题，请使用包含完整星期栏的课表截图".into());
    }
    let sections = section_markers(tokens, working_width);
    let anchors = course_anchors(tokens);
    let (courses, mut warnings) = if anchors.is_empty() {
        let courses = fallback_courses(tokens, &headers, &sections, working_width, working_height);
        (
            courses,
            vec!["未识别到完整周次锚点，已按课表网格生成待复核结果".into()],
        )
    } else {
        anchor_courses(
            tokens,
            &anchors,
            &headers,
            working_width,
            working_height,
        )
    };
    if courses.is_empty() {
        return Err("识别到了课表文字，但没有整理出可复核的课程安排".into());
    }

    let highest_week = courses
        .iter()
        .flat_map(|course| course.weeks.iter().copied())
        .max()
        .unwrap_or(DEFAULT_LAST_WEEK);
    let location_count = courses
        .iter()
        .filter(|course| course.location.as_deref().is_some_and(|value| !value.trim().is_empty()))
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
            section_rows: sections
                .iter()
                .map(|(section, _)| *section)
                .max(),
            recognizer_version: Some(RECOGNIZER_VERSION.into()),
        }),
    })
}

fn anchor_courses(
    tokens: &[Token],
    anchors: &[CourseAnchor],
    headers: &[WeekdayHeader],
    image_width: u32,
    image_height: u32,
) -> (Vec<ImportCourse>, Vec<String>) {
    let mut courses = Vec::new();
    let mut warnings = Vec::new();
    for anchor in anchors {
        let anchor_token = &tokens[anchor.token_index];
        let column_bounds = weekday_column_bounds(headers, anchor.weekday, image_width as f32);
        let next_top = anchors
            .iter()
            .filter(|candidate| {
                candidate.weekday == anchor.weekday
                    && tokens[candidate.token_index].top > anchor_token.top
            })
            .map(|candidate| tokens[candidate.token_index].top)
            .min_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
        let lower_bound = next_top
            .map(|top| top - 2.0)
            .unwrap_or(anchor_token.bottom() + anchor_token.height.max(28.0) * 5.5);
        let mut block = tokens
            .iter()
            .enumerate()
            .filter(|(index, token)| {
                *index != anchor.token_index
                    && token.center_x() >= column_bounds.0
                    && token.center_x() < column_bounds.1
                    && token.center_y() >= anchor_token.center_y()
                    && token.top < lower_bound
                    && !is_weekday_header(&token.text)
                    && !is_section_number(&token.text)
            })
            .map(|(_, token)| token.clone())
            .collect::<Vec<_>>();
        block.sort_by(token_reading_order);
        if let Some(course) = course_from_block(
            anchor.weekday,
            anchor.start_section,
            anchor.end_section,
            anchor.weeks.clone(),
            anchor.parity.clone(),
            anchor.used_default_weeks,
            anchor_token,
            &block,
            image_width,
            image_height,
        ) {
            if anchor.used_default_weeks {
                warnings.push(format!("{} 的周次未完整识别，已暂按 1～{DEFAULT_LAST_WEEK} 周填写", course.name));
            }
            courses.push(course);
        }
    }
    (courses, warnings)
}

#[allow(clippy::too_many_arguments)]
fn course_from_block(
    weekday: u8,
    start_section: u8,
    end_section: u8,
    weeks: Vec<u8>,
    parity: String,
    default_weeks: bool,
    anchor: &Token,
    block: &[Token],
    image_width: u32,
    image_height: u32,
) -> Option<ImportCourse> {
    let teacher = block.iter().find(|token| is_teacher_text(&token.text));
    let location = block.iter().find(|token| is_location_text(&token.text));
    let name_token = block.iter().find(|token| {
        !is_teacher_text(&token.text)
            && !is_location_text(&token.text)
            && !looks_like_schedule_metadata(&token.text)
            && token.text.chars().any(|character| !character.is_ascii_digit())
    })?;
    let mut source_tokens = vec![anchor.clone()];
    source_tokens.extend(block.iter().cloned());
    let source_box = normalized_union(&source_tokens, image_width, image_height);

    let mut fields = vec![field_evidence(
        ImportFieldKey::Name,
        ImportReviewStatus::Review,
        Some(name_token),
        "本地 OCR 课程名称需确认",
        image_width,
        image_height,
    )];
    fields.push(optional_field_evidence(
        ImportFieldKey::Teacher,
        teacher,
        "未识别到老师，可留空",
        image_width,
        image_height,
    ));
    fields.push(optional_field_evidence(
        ImportFieldKey::Location,
        location,
        "未识别到地点，可留空",
        image_width,
        image_height,
    ));
    fields.push(ImportFieldEvidence {
        field: ImportFieldKey::Weeks,
        status: ImportReviewStatus::Review,
        confidence: Some(anchor.confidence),
        raw_text: Some(anchor.text.clone()),
        source_box: normalized_box(anchor, image_width, image_height),
        reason: Some(if default_weeks {
            "周次未完整识别，已填入默认范围，请修改后确认".into()
        } else {
            "本地 OCR 周次需确认".into()
        }),
    });
    fields.push(ImportFieldEvidence {
        field: ImportFieldKey::Parity,
        status: ImportReviewStatus::Review,
        confidence: Some(anchor.confidence),
        raw_text: Some(anchor.text.clone()),
        source_box: normalized_box(anchor, image_width, image_height),
        reason: Some("本地 OCR 单双周需确认".into()),
    });

    Some(ImportCourse {
        code: None,
        name: name_token.text.clone(),
        teacher: teacher.map(|token| token.text.clone()),
        weekday,
        start_section,
        end_section,
        weeks,
        parity,
        location: location.map(|token| token.text.clone()),
        review: Some(ImportCourseReview { source_box, fields }),
    })
}

fn fallback_courses(
    tokens: &[Token],
    headers: &[WeekdayHeader],
    sections: &[(u8, f32)],
    image_width: u32,
    image_height: u32,
) -> Vec<ImportCourse> {
    if sections.len() < 2 {
        return Vec::new();
    }
    let header_bottom = headers
        .iter()
        .map(|header| header.bottom)
        .fold(0.0_f32, f32::max);
    let mut courses = Vec::new();
    for header in headers {
        let bounds = weekday_column_bounds(headers, header.weekday, image_width as f32);
        let mut column_tokens = tokens
            .iter()
            .filter(|token| {
                token.center_x() >= bounds.0
                    && token.center_x() < bounds.1
                    && token.top > header_bottom
                    && !is_weekday_header(&token.text)
                    && !is_section_number(&token.text)
            })
            .cloned()
            .collect::<Vec<_>>();
        column_tokens.sort_by(token_reading_order);
        let mut groups: Vec<Vec<Token>> = Vec::new();
        for token in column_tokens {
            let starts_new = groups.last().and_then(|group| group.last()).is_some_and(|previous| {
                token.top - previous.bottom() > previous.height.max(token.height).max(18.0) * 1.3
            });
            if starts_new || groups.is_empty() {
                groups.push(vec![token]);
            } else if let Some(group) = groups.last_mut() {
                group.push(token);
            }
        }

        for group in groups {
            let combined = group.iter().map(|token| token.text.as_str()).collect::<Vec<_>>().join(" ");
            let Some(name_token) = group.iter().find(|token| {
                !is_teacher_text(&token.text)
                    && !is_location_text(&token.text)
                    && !looks_like_schedule_metadata(&token.text)
            }) else {
                continue;
            };
            let first_y = group.first().map(Token::center_y).unwrap_or_default();
            let last_y = group.last().map(Token::center_y).unwrap_or(first_y);
            let start_section = nearest_section(sections, first_y);
            let end_section = nearest_section(sections, last_y).max(start_section);
            let (weeks, parity, used_default_weeks) = parse_weeks_and_parity(&combined);
            let anchor = group.first().unwrap_or(name_token);
            if let Some(course) = course_from_block(
                header.weekday,
                start_section,
                end_section,
                weeks,
                parity,
                used_default_weeks,
                anchor,
                &group,
                image_width,
                image_height,
            ) {
                courses.push(course);
            }
        }
    }
    courses
}

fn weekday_headers(tokens: &[Token]) -> Vec<WeekdayHeader> {
    let mut headers = tokens
        .iter()
        .filter_map(|token| weekday_from_text(&token.text).map(|weekday| WeekdayHeader {
            weekday,
            center_x: token.center_x(),
            bottom: token.bottom(),
        }))
        .collect::<Vec<_>>();
    headers.sort_by(|left, right| left.center_x.partial_cmp(&right.center_x).unwrap_or(Ordering::Equal));
    headers.dedup_by_key(|header| header.weekday);
    headers
}

fn section_markers(tokens: &[Token], image_width: u32) -> Vec<(u8, f32)> {
    let mut markers = tokens
        .iter()
        .filter(|token| token.center_x() < image_width as f32 * 0.12)
        .filter_map(|token| token.text.parse::<u8>().ok().map(|section| (section, token.center_y())))
        .filter(|(section, _)| (1..=20).contains(section))
        .collect::<Vec<_>>();
    markers.sort_by_key(|(section, _)| *section);
    markers.dedup_by_key(|(section, _)| *section);
    markers
}

fn course_anchors(tokens: &[Token]) -> Vec<CourseAnchor> {
    let anchor = Regex::new(r"(?:周|星期)([一二三四五六日天]).*?第?\s*(\d{1,2})\s*节\s*[-—~至]\s*第?\s*(\d{1,2})\s*节").unwrap();
    let mut anchors = tokens
        .iter()
        .enumerate()
        .filter_map(|(token_index, token)| {
            let captures = anchor.captures(&token.text)?;
            let weekday = weekday_character(captures.get(1)?.as_str().chars().next()?)?;
            let start_section = captures.get(2)?.as_str().parse::<u8>().ok()?;
            let end_section = captures.get(3)?.as_str().parse::<u8>().ok()?;
            if start_section == 0 || end_section < start_section || end_section > 20 {
                return None;
            }
            let (weeks, parity, used_default_weeks) = parse_weeks_and_parity(&token.text);
            Some(CourseAnchor {
                token_index,
                weekday,
                start_section,
                end_section,
                weeks,
                parity,
                used_default_weeks,
            })
        })
        .collect::<Vec<_>>();
    anchors.sort_by(|left, right| {
        left.weekday
            .cmp(&right.weekday)
            .then(left.start_section.cmp(&right.start_section))
    });
    anchors
}

fn parse_weeks_and_parity(text: &str) -> (Vec<u8>, String, bool) {
    let range = Regex::new(r"(\d{1,2})\s*[-—~至]\s*(\d{1,2})\s*周").unwrap();
    let single = Regex::new(r"(?:第)?\s*(\d{1,2})\s*周").unwrap();
    let weeks = range
        .captures(text)
        .and_then(|captures| {
            let start = captures.get(1)?.as_str().parse::<u8>().ok()?;
            let end = captures.get(2)?.as_str().parse::<u8>().ok()?;
            (start > 0 && end >= start && end <= 30).then(|| (start..=end).collect::<Vec<_>>())
        })
        .or_else(|| {
            single.captures(text).and_then(|captures| {
                let week = captures.get(1)?.as_str().parse::<u8>().ok()?;
                (week > 0 && week <= 30).then_some(vec![week])
            })
        });
    let used_default = weeks.is_none();
    let mut weeks = weeks.unwrap_or_else(|| (1..=DEFAULT_LAST_WEEK).collect());
    let parity = if text.contains('单') {
        weeks.retain(|week| week % 2 == 1);
        "odd"
    } else if text.contains('双') {
        weeks.retain(|week| week % 2 == 0);
        "even"
    } else {
        "all"
    };
    (weeks, parity.into(), used_default)
}

fn weekday_column_bounds(headers: &[WeekdayHeader], weekday: u8, image_width: f32) -> (f32, f32) {
    let Some(index) = headers.iter().position(|header| header.weekday == weekday) else {
        return (0.0, image_width);
    };
    let left = if index == 0 {
        0.0
    } else {
        (headers[index - 1].center_x + headers[index].center_x) / 2.0
    };
    let right = if index + 1 == headers.len() {
        image_width
    } else {
        (headers[index].center_x + headers[index + 1].center_x) / 2.0
    };
    (left, right)
}

fn nearest_section(sections: &[(u8, f32)], y: f32) -> u8 {
    sections
        .iter()
        .min_by(|left, right| {
            (left.1 - y)
                .abs()
                .partial_cmp(&(right.1 - y).abs())
                .unwrap_or(Ordering::Equal)
        })
        .map(|(section, _)| *section)
        .unwrap_or(1)
}

fn optional_field_evidence(
    field: ImportFieldKey,
    token: Option<&Token>,
    missing_reason: &str,
    image_width: u32,
    image_height: u32,
) -> ImportFieldEvidence {
    match token {
        Some(token) => field_evidence(
            field,
            ImportReviewStatus::Review,
            Some(token),
            "本地 OCR 字段需确认",
            image_width,
            image_height,
        ),
        None => ImportFieldEvidence {
            field,
            status: ImportReviewStatus::Missing,
            confidence: None,
            raw_text: None,
            source_box: None,
            reason: Some(missing_reason.into()),
        },
    }
}

fn field_evidence(
    field: ImportFieldKey,
    status: ImportReviewStatus,
    token: Option<&Token>,
    reason: &str,
    image_width: u32,
    image_height: u32,
) -> ImportFieldEvidence {
    ImportFieldEvidence {
        field,
        status,
        confidence: token.map(|token| token.confidence),
        raw_text: token.map(|token| token.text.clone()),
        source_box: token.and_then(|token| normalized_box(token, image_width, image_height)),
        reason: Some(reason.into()),
    }
}

fn normalized_box(token: &Token, image_width: u32, image_height: u32) -> Option<NormalizedImageBox> {
    if image_width == 0 || image_height == 0 {
        return None;
    }
    Some(NormalizedImageBox {
        x: (token.left / image_width as f32).clamp(0.0, 1.0),
        y: (token.top / image_height as f32).clamp(0.0, 1.0),
        width: (token.width / image_width as f32).clamp(f32::EPSILON, 1.0),
        height: (token.height / image_height as f32).clamp(f32::EPSILON, 1.0),
    })
}

fn normalized_union(tokens: &[Token], image_width: u32, image_height: u32) -> Option<NormalizedImageBox> {
    if tokens.is_empty() || image_width == 0 || image_height == 0 {
        return None;
    }
    let left = tokens.iter().map(|token| token.left).fold(f32::MAX, f32::min);
    let top = tokens.iter().map(|token| token.top).fold(f32::MAX, f32::min);
    let right = tokens.iter().map(Token::right).fold(0.0_f32, f32::max);
    let bottom = tokens.iter().map(Token::bottom).fold(0.0_f32, f32::max);
    Some(NormalizedImageBox {
        x: (left / image_width as f32).clamp(0.0, 1.0),
        y: (top / image_height as f32).clamp(0.0, 1.0),
        width: ((right - left) / image_width as f32).clamp(f32::EPSILON, 1.0),
        height: ((bottom - top) / image_height as f32).clamp(f32::EPSILON, 1.0),
    })
}

fn resolve_model_root(app: &AppHandle) -> Result<PathBuf, String> {
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join(".tmp/native-ocr-models"));
    if cfg!(debug_assertions) {
        if let Some(path) = development.filter(|path| path.is_dir()) {
            return Ok(path);
        }
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录：{error}"))?;
    let bundled = resource_dir.join("ocr-native");
    if bundled.is_dir() {
        return Ok(bundled);
    }
    Err("当前安装包没有包含本地文字识别模型".into())
}

fn bounded_image(image: DynamicImage, max_side: u32) -> DynamicImage {
    if max_side == 0 || image.width().max(image.height()) <= max_side {
        return image;
    }
    image.resize(max_side, max_side, image::imageops::FilterType::Lanczos3)
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

fn token_reading_order(left: &Token, right: &Token) -> Ordering {
    left.top
        .partial_cmp(&right.top)
        .unwrap_or(Ordering::Equal)
        .then_with(|| left.left.partial_cmp(&right.left).unwrap_or(Ordering::Equal))
}

fn compact_text(value: &str) -> String {
    value.split_whitespace().collect::<String>()
}

fn is_weekday_header(value: &str) -> bool {
    weekday_from_text(value).is_some()
}

fn weekday_from_text(value: &str) -> Option<u8> {
    let compact = compact_text(value);
    let suffix = compact.strip_prefix("星期").or_else(|| compact.strip_prefix('周'))?;
    if suffix.chars().count() != 1 {
        return None;
    }
    weekday_character(suffix.chars().next()?)
}

fn weekday_character(value: char) -> Option<u8> {
    match value {
        '一' => Some(1),
        '二' => Some(2),
        '三' => Some(3),
        '四' => Some(4),
        '五' => Some(5),
        '六' => Some(6),
        '日' | '天' => Some(7),
        _ => None,
    }
}

fn is_section_number(value: &str) -> bool {
    value.parse::<u8>().is_ok_and(|number| (1..=20).contains(&number))
}

fn is_teacher_text(value: &str) -> bool {
    value.contains("老师") || value.contains("教师") || value.ends_with("教授")
}

fn is_location_text(value: &str) -> bool {
    ["教学楼", "教室", "校区", "楼", "室", "阶", "馆", "南湖", "南岭", "中心"]
        .iter()
        .any(|marker| value.contains(marker))
}

fn looks_like_schedule_metadata(value: &str) -> bool {
    value.contains('周') && (value.contains('节') || value.chars().any(|character| character.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(text: &str, left: f32, top: f32) -> Token {
        Token {
            text: text.into(),
            confidence: 0.98,
            left,
            top,
            width: 100.0,
            height: 28.0,
        }
    }

    #[test]
    fn parses_anchor_weeks_and_parity() {
        let tokens = vec![token("周五第6节-第7节1-15周(单)", 900.0, 500.0)];
        let anchors = course_anchors(&tokens);
        assert_eq!(anchors.len(), 1);
        assert_eq!(anchors[0].weekday, 5);
        assert_eq!(anchors[0].start_section, 6);
        assert_eq!(anchors[0].end_section, 7);
        assert_eq!(anchors[0].parity, "odd");
        assert_eq!(anchors[0].weeks, vec![1, 3, 5, 7, 9, 11, 13, 15]);
    }

    #[test]
    fn extracts_course_from_native_tokens() {
        let tokens = vec![
            token("周一", 190.0, 40.0),
            token("周二", 390.0, 40.0),
            token("周三", 590.0, 40.0),
            token("周一第1节-第2节1-8周", 130.0, 110.0),
            token("通信原理", 130.0, 145.0),
            token("张老师", 130.0, 177.0),
            token("南湖-第一教学楼-四阶", 130.0, 209.0),
        ];
        let headers = weekday_headers(&tokens);
        let anchors = course_anchors(&tokens);
        let (courses, warnings) = anchor_courses(&tokens, &anchors, &headers, 800, 600);
        assert!(warnings.is_empty());
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "通信原理");
        assert_eq!(courses[0].teacher.as_deref(), Some("张老师"));
        assert_eq!(courses[0].location.as_deref(), Some("南湖-第一教学楼-四阶"));
        assert_eq!(courses[0].weeks, (1..=8).collect::<Vec<_>>());
    }
}
