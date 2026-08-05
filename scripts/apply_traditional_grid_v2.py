from pathlib import Path
import re

ROOT = Path("src-tauri/src/native_ocr")


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def write(name: str, text: str) -> None:
    (ROOT / name).write_text(text, encoding="utf-8", newline="\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one {label}, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"missing start for {label}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"missing end for {label}")
    return text[:start_index] + replacement.rstrip() + "\n\n" + text[end_index:]


# runtime.rs: expand multiline OCR boxes before layout parsing and use the v5 parser marker.
runtime = read("runtime.rs")
runtime = replace_once(
    runtime,
    'const RECOGNIZER_VERSION: &str = "ocr-rs-mnn-ppocrv5-mobile-v4";',
    'const RECOGNIZER_VERSION: &str = "ocr-rs-mnn-ppocrv5-mobile-v5";',
    "recognizer version",
)
runtime = replace_once(
    runtime,
    '''    let tokens = results
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
''',
    '''    let raw_tokens = results
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
    if raw_tokens.is_empty() {
        return Err("没有从图片中识别到文字，请确认截图清晰且包含完整课表".into());
    }
    let tokens = expand_multiline_tokens(raw_tokens);
''',
    "multiline token expansion",
)
runtime = replace_once(
    runtime,
    "        timetable_content_bottom(&sections, working_height)",
    "        timetable_content_bottom(&tokens, &sections, working_height)",
    "table bottom call",
)
write("runtime.rs", runtime)


# support.rs: shared multiline expansion, structural boundaries and stronger footer/header rejection.
support = read("support.rs")
insert = '''fn expand_multiline_tokens(tokens: Vec<Token>) -> Vec<Token> {
    let mut expanded = Vec::new();
    for token in tokens {
        let parts = token
            .parts
            .iter()
            .map(|part| compact_text(part))
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.len() <= 1 {
            expanded.push(token);
            continue;
        }

        let line_height = (token.height / parts.len() as f32).max(1.0);
        for (index, part) in parts.into_iter().enumerate() {
            expanded.push(Token {
                text: part.clone(),
                parts: vec![part],
                confidence: token.confidence,
                left: token.left,
                top: token.top + line_height * index as f32,
                width: token.width,
                height: line_height,
            });
        }
    }
    expanded.sort_by(token_reading_order);
    expanded
}

fn is_footer_table_header(value: &str) -> bool {
    matches!(
        compact_text(value).as_str(),
        "调停课信息"
            | "调、停（补）课信息"
            | "调停（补）课信息"
            | "实践课信息"
            | "实践课（或无上课时间）信息"
            | "实习课信息"
            | "实习时间"
            | "先修模块"
            | "未安排上课时间的课程"
            | "原上课时间地点教师"
            | "现上课时间地点教师"
            | "申请时间"
            | "课程名称"
            | "教师姓名"
            | "模块代码"
            | "学分"
            | "起止周"
    )
}

fn token_is_course_boundary(token: &Token) -> bool {
    token
        .parts
        .iter()
        .chain(std::iter::once(&token.text))
        .any(|value| {
            is_location_text(value)
                || compact_location_from_text(value).is_some()
                || looks_like_schedule_metadata(value)
                || section_range_from_text(value).is_some()
                || weekday_from_schedule_text(value).is_some()
        })
}

'''
support = insert + support
support = replace_once(
    support,
    '''        "调停课信息",
        "调、停（补）课信息",
''',
    '''        "调停课信息",
        "调、停（补）课信息",
        "调停（补）课信息",
        "实践课信息",
        "实践课（或无上课时间）信息",
        "实习课信息",
        "实习时间",
        "先修模块",
        "未安排上课时间的课程",
        "原上课时间地点教师",
        "现上课时间地点教师",
        "教师姓名",
        "模块代码",
''',
    "common footer headers",
)
write("support.rs", support)


# grid.rs: only use the actual left marker column and stop exactly at the main grid footer.
grid = read("grid.rs")
grid = grid.replace("\nlet parsed_anchors = course_anchors(&group);", "\n            let parsed_anchors = course_anchors(&group);")
new_section_markers = r'''fn section_markers(tokens: &[Token], image_width: u32) -> Vec<(u8, f32)> {
    let headers = weekday_headers(tokens);
    let marker_cutoff = headers
        .iter()
        .min_by(|left, right| {
            left.center_x
                .partial_cmp(&right.center_x)
                .unwrap_or(Ordering::Equal)
        })
        .map(|header| weekday_column_bounds(&headers, header.weekday, image_width as f32).0)
        .filter(|cutoff| *cutoff > image_width as f32 * 0.025)
        .unwrap_or(image_width as f32 * 0.18)
        .min(image_width as f32 * 0.18);

    let mut detected = tokens
        .iter()
        .filter(|token| token.center_x() < marker_cutoff)
        .filter_map(|token| {
            section_marker_number_from_text(&token.text).map(|section| (section, token.center_y()))
        })
        .collect::<Vec<_>>();
    detected.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.partial_cmp(&right.1).unwrap_or(Ordering::Equal))
    });
    detected.dedup_by_key(|(section, _)| *section);
    if detected.len() < 2 {
        return detected;
    }

    let mut spacings = detected
        .windows(2)
        .filter_map(|pair| {
            let section_delta = pair[1].0.saturating_sub(pair[0].0);
            (section_delta > 0).then_some((pair[1].1 - pair[0].1) / section_delta as f32)
        })
        .filter(|spacing| spacing.is_finite() && *spacing > 4.0)
        .collect::<Vec<_>>();
    if spacings.is_empty() {
        return detected;
    }
    spacings.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let spacing = spacings[spacings.len() / 2];
    let reference = detected[0];
    let last_section = detected
        .iter()
        .map(|(section, _)| *section)
        .max()
        .unwrap_or(DEFAULT_SECTION_COUNT)
        .max(DEFAULT_SECTION_COUNT);
    (1..=last_section)
        .map(|section| {
            let offset = section as i16 - reference.0 as i16;
            (section, reference.1 + spacing * offset as f32)
        })
        .collect()
}

fn section_marker_number_from_text(value: &str) -> Option<u8> {
    let compact = compact_text(value);
    if let Ok(section) = compact.parse::<u8>() {
        return (1..=20).contains(&section).then_some(section);
    }

    let labelled = Regex::new(r"^第?(\d{1,2})(?:节|课)$").unwrap();
    if let Some(captures) = labelled.captures(&compact) {
        let section = captures.get(1)?.as_str().parse::<u8>().ok()?;
        return (1..=20).contains(&section).then_some(section);
    }

    let combined_time = Regex::new(r"^(\d{1,2})(\d{2}[:：]\d{2})$").unwrap();
    if let Some(captures) = combined_time.captures(&compact) {
        let section = captures.get(1)?.as_str().parse::<u8>().ok()?;
        return (1..=20).contains(&section).then_some(section);
    }
    None
}'''
grid = replace_between(
    grid,
    "fn section_markers(",
    "fn timetable_content_bottom(",
    new_section_markers,
    "section marker detection",
)
new_bottom = r'''fn timetable_content_bottom(
    tokens: &[Token],
    sections: &[(u8, f32)],
    image_height: u32,
) -> f32 {
    if sections.len() < 2 {
        return image_height as f32 * 0.98;
    }

    let mut spacings = sections
        .windows(2)
        .filter_map(|pair| {
            let section_delta = pair[1].0.saturating_sub(pair[0].0);
            (section_delta > 0).then_some((pair[1].1 - pair[0].1) / section_delta as f32)
        })
        .filter(|spacing| spacing.is_finite() && *spacing > 4.0)
        .collect::<Vec<_>>();
    if spacings.is_empty() {
        return image_height as f32 * 0.98;
    }
    spacings.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let row_height = spacings[spacings.len() / 2];
    let last_center = sections
        .iter()
        .map(|(_, center)| *center)
        .fold(0.0_f32, f32::max);
    let geometric_bottom = (last_center + row_height * 0.50)
        .max(last_center)
        .min(image_height as f32 * 0.995);

    let footer_top = tokens
        .iter()
        .filter(|token| token.top > last_center + row_height * 0.20)
        .filter(|token| is_footer_table_header(&token.text))
        .map(|token| token.top)
        .min_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));

    footer_top
        .map(|top| geometric_bottom.min((top - 1.0).max(last_center)))
        .unwrap_or(geometric_bottom)
}'''
grid = replace_between(
    grid,
    "fn timetable_content_bottom(",
    "fn section_number_from_text(",
    new_bottom,
    "table content bottom",
)
write("grid.rs", grid)


# metadata.rs: comma-separated sections, week unions, teacher lists and title barriers.
metadata = read("metadata.rs")
new_sections = r'''fn section_range_from_text(value: &str) -> Option<(u8, u8)> {
    let compact = compact_text(value);

    let listed = Regex::new(r"第?(\d{1,2}(?:[,，、]\d{1,2})+)节").unwrap();
    if let Some(captures) = listed.captures(&compact) {
        let mut sections = captures
            .get(1)?
            .as_str()
            .split([',', '，', '、'])
            .filter_map(|value| value.parse::<u8>().ok())
            .filter(|section| (1..=20).contains(section))
            .collect::<Vec<_>>();
        sections.sort_unstable();
        sections.dedup();
        if let (Some(start), Some(end)) = (sections.first(), sections.last()) {
            return Some((*start, *end));
        }
    }

    let patterns = [
        r"第?(\d{1,2})节(?:[-—~－–‑]+|至|到)第?(\d{1,2})节?",
        r"第?(\d{1,2})(?:[-—~－–‑]+|至|到)第?(\d{1,2})节",
    ];
    for pattern in patterns {
        let regex = Regex::new(pattern).unwrap();
        let Some(captures) = regex.captures(&compact) else {
            continue;
        };
        let start = captures.get(1)?.as_str().parse::<u8>().ok()?;
        let end = captures.get(2)?.as_str().parse::<u8>().ok()?;
        if start > 0 && end >= start && end <= 20 {
            return Some((start, end));
        }
    }
    None
}'''
metadata = replace_between(
    metadata,
    "fn section_range_from_text(",
    "fn parse_weeks_and_parity(",
    new_sections,
    "section list parser",
)
new_weeks = r'''fn parse_weeks_and_parity(text: &str) -> (Vec<u8>, String, bool) {
    let compact = compact_text(text);
    let mut parsed = std::collections::BTreeSet::new();

    let ranges = Regex::new(r"(?:第)?(\d{1,2})\s*(?:[-—~－–‑]+|至|到)\s*(\d{1,2})\s*周")
        .unwrap();
    for captures in ranges.captures_iter(&compact) {
        let Some(start) = captures.get(1).and_then(|value| value.as_str().parse::<u8>().ok()) else {
            continue;
        };
        let Some(end) = captures.get(2).and_then(|value| value.as_str().parse::<u8>().ok()) else {
            continue;
        };
        if start > 0 && end >= start && end <= 30 {
            parsed.extend(start..=end);
        }
    }

    let lists = Regex::new(r"(?:第)?(\d{1,2}(?:[,，、]\d{1,2})+)周").unwrap();
    for captures in lists.captures_iter(&compact) {
        if let Some(values) = captures.get(1) {
            parsed.extend(
                values
                    .as_str()
                    .split([',', '，', '、'])
                    .filter_map(|value| value.parse::<u8>().ok())
                    .filter(|week| (1..=30).contains(week)),
            );
        }
    }

    let singles = Regex::new(r"(?:第)?(\d{1,2})周").unwrap();
    for captures in singles.captures_iter(&compact) {
        if let Some(week) = captures
            .get(1)
            .and_then(|value| value.as_str().parse::<u8>().ok())
            .filter(|week| (1..=30).contains(week))
        {
            parsed.insert(week);
        }
    }

    let used_default = parsed.is_empty();
    let mut weeks = if used_default {
        (1..=DEFAULT_LAST_WEEK).collect::<Vec<_>>()
    } else {
        parsed.into_iter().collect::<Vec<_>>()
    };
    let parity = if compact.contains("单周")
        || compact.contains("(单)")
        || compact.contains("（单）")
    {
        weeks.retain(|week| week % 2 == 1);
        "odd"
    } else if compact.contains("双周")
        || compact.contains("(双)")
        || compact.contains("（双）")
    {
        weeks.retain(|week| week % 2 == 0);
        "even"
    } else {
        "all"
    };
    (weeks, parity.into(), used_default)
}'''
metadata = replace_between(
    metadata,
    "fn parse_weeks_and_parity(",
    "fn weekday_column_bounds(",
    new_weeks,
    "week union parser",
)
new_teacher = r'''fn is_bare_teacher_name(value: &str) -> bool {
    let compact = compact_text(value);
    if matches!(
        compact.as_str(),
        "未识别"
            | "待确认"
            | "未知教师"
            | "暂无教师"
            | "教师"
            | "老师"
            | "周单周"
            | "周双周"
            | "单周"
            | "双周"
            | "单双周"
    ) || is_common_header(&compact)
        || is_location_text(&compact)
        || looks_like_schedule_metadata(&compact)
    {
        return false;
    }

    let names = compact
        .split(['/', '／', '、'])
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    !names.is_empty()
        && names.len() <= 3
        && names.iter().all(|name| {
            let count = name.chars().count();
            (2..=4).contains(&count)
                && name
                    .chars()
                    .all(|character| ('\u{4e00}'..='\u{9fff}').contains(&character))
        })
}'''
metadata = replace_between(
    metadata,
    "fn is_bare_teacher_name(",
    "fn looks_like_roster_text(",
    new_teacher,
    "teacher list parser",
)
old_loop = '''            while first_index > 0 && before_anchor.len() - first_index < 4 {
                let previous = &before_anchor[first_index - 1].0;
                let current = &before_anchor[first_index].0;
                let typical_height = previous.height.max(current.height).max(18.0);
                let vertical_gap = current.top - previous.bottom();
                if vertical_gap > typical_height * 1.35 + 8.0
                    || vertical_gap < -typical_height * 0.8
                {
                    break;
                }
                let overlap = (previous.right().min(current.right())
                    - previous.left.max(current.left))
                    .max(0.0);
                let minimum_width = previous.width.min(current.width).max(1.0);
                let center_distance = (previous.center_x() - current.center_x()).abs();
                if overlap < minimum_width * 0.12
                    && center_distance > previous.width.max(current.width) * 0.65
                {
                    break;
                }
                first_index -= 1;
            }
'''
new_loop = '''            while first_index > 0 && before_anchor.len() - first_index < 4 {
                let (previous, previous_name) = &before_anchor[first_index - 1];
                let (current, current_name) = &before_anchor[first_index];
                let typical_height = previous.height.max(current.height).max(18.0);
                let vertical_gap = current.top - previous.bottom();
                if vertical_gap > typical_height * 1.35 + 8.0
                    || vertical_gap < -typical_height * 0.8
                {
                    break;
                }
                let has_boundary_between = tokens.iter().any(|candidate| {
                    candidate.center_y() > previous.center_y() + 0.5
                        && candidate.center_y() < current.center_y() - 0.5
                        && token_is_course_boundary(candidate)
                });
                if has_boundary_between
                    || (is_bare_teacher_name(previous_name)
                        && current_name.chars().count() > 4)
                {
                    break;
                }
                let overlap = (previous.right().min(current.right())
                    - previous.left.max(current.left))
                    .max(0.0);
                let minimum_width = previous.width.min(current.width).max(1.0);
                let center_distance = (previous.center_x() - current.center_x()).abs();
                if overlap < minimum_width * 0.12
                    && center_distance > previous.width.max(current.width) * 0.65
                {
                    break;
                }
                first_index -= 1;
            }
'''
metadata = replace_once(metadata, old_loop, new_loop, "title boundary loop")
write("metadata.rs", metadata)


# courses.rs: derive vertical blocks from title starts and restrict field candidates to this course.
courses = read("courses.rs")
old_bounds = '''        let header_bottom = headers
            .iter()
            .find(|header| header.weekday == anchor.weekday)
            .map(|header| header.bottom)
            .unwrap_or(0.0);
        let upper_bound = previous_anchor
            .map(|candidate| {
                (tokens[candidate.token_index].center_y() + anchor_token.center_y()) / 2.0
            })
            .unwrap_or_else(|| {
                (anchor_token.center_y() - anchor_token.height.max(24.0) * 4.5)
                    .max(header_bottom)
            });
        let lower_bound = next_anchor
            .map(|candidate| {
                (anchor_token.center_y() + tokens[candidate.token_index].center_y()) / 2.0
            })
            .unwrap_or(anchor_token.center_y() + anchor_token.height.max(24.0) * 4.5);
'''
new_bounds = '''        let header_bottom = headers
            .iter()
            .find(|header| header.weekday == anchor.weekday)
            .map(|header| header.bottom)
            .unwrap_or(0.0);
        let previous_anchor_y = previous_anchor
            .map(|candidate| tokens[candidate.token_index].center_y())
            .unwrap_or(header_bottom);
        let upper_bound = title_start_before_anchor(
            tokens,
            column_bounds,
            previous_anchor_y,
            anchor_token,
        )
        .unwrap_or_else(|| {
            previous_anchor
                .map(|candidate| {
                    (tokens[candidate.token_index].center_y() + anchor_token.center_y()) / 2.0
                })
                .unwrap_or_else(|| {
                    (anchor_token.center_y() - anchor_token.height.max(24.0) * 4.5)
                        .max(header_bottom)
                })
        });
        let lower_bound = next_anchor
            .and_then(|candidate| {
                title_start_before_anchor(
                    tokens,
                    column_bounds,
                    anchor_token.center_y(),
                    &tokens[candidate.token_index],
                )
            })
            .or_else(|| {
                next_anchor.map(|candidate| {
                    (anchor_token.center_y() + tokens[candidate.token_index].center_y()) / 2.0
                })
            })
            .unwrap_or(anchor_token.center_y() + anchor_token.height.max(24.0) * 4.5);
'''
courses = replace_once(courses, old_bounds, new_bounds, "anchor block bounds")
old_fields = '''    let (name_token, name) = find_course_name(candidates.iter().copied(), anchor)?;
    let teacher = find_teacher_fragment(candidates.iter().copied(), name_token, &name, anchor)
        .or_else(|| find_teacher_after_schedule(candidates.iter().copied(), &name, anchor));
    let location = find_location_fragment(candidates.iter().copied())
        .or_else(|| find_compact_location(candidates.iter().copied()));
'''
new_fields = '''    let (name_token, name) = find_course_name(candidates.iter().copied(), anchor)?;
    let field_candidates = candidates
        .iter()
        .copied()
        .filter(|token| token.center_y() >= name_token.center_y() - 1.0)
        .collect::<Vec<_>>();
    let teacher = find_teacher_fragment(
        field_candidates.iter().copied(),
        name_token,
        &name,
        anchor,
    )
    .or_else(|| {
        find_teacher_after_schedule(field_candidates.iter().copied(), &name, anchor)
    });
    let location = find_location_after_schedule(field_candidates.iter().copied(), anchor)
        .or_else(|| find_location_fragment(field_candidates.iter().copied()))
        .or_else(|| find_compact_location(field_candidates.iter().copied()));
'''
courses = replace_once(courses, old_fields, new_fields, "course field candidates")
helper = r'''
fn title_start_before_anchor(
    tokens: &[Token],
    column_bounds: (f32, f32),
    lower_limit: f32,
    anchor: &Token,
) -> Option<f32> {
    let mut candidates = tokens
        .iter()
        .filter(|token| {
            token.center_x() >= column_bounds.0
                && token.center_x() < column_bounds.1
                && token.center_y() > lower_limit + 0.5
                && token.center_y() < anchor.center_y() - 0.5
        })
        .filter_map(|token| name_fragment_from_token(token).map(|name| (token, name)))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| token_reading_order(left.0, right.0));
    let mut first_index = candidates.len().checked_sub(1)?;
    while first_index > 0 && candidates.len() - first_index < 4 {
        let (previous, previous_name) = &candidates[first_index - 1];
        let (current, current_name) = &candidates[first_index];
        let typical_height = previous.height.max(current.height).max(18.0);
        let vertical_gap = current.top - previous.bottom();
        let has_boundary_between = tokens.iter().any(|candidate| {
            candidate.center_y() > previous.center_y() + 0.5
                && candidate.center_y() < current.center_y() - 0.5
                && token_is_course_boundary(candidate)
        });
        if vertical_gap > typical_height * 1.35 + 8.0
            || vertical_gap < -typical_height * 0.8
            || has_boundary_between
            || (is_bare_teacher_name(previous_name) && current_name.chars().count() > 4)
        {
            break;
        }
        first_index -= 1;
    }
    Some(candidates[first_index].0.top)
}
'''
courses = courses.rstrip() + "\n" + helper + "\n"
write("courses.rs", courses)


# traditional_fields.rs: prefer the first valid location after this course's schedule line.
traditional = read("traditional_fields.rs")
location_after = r'''
fn find_location_after_schedule<'a>(
    tokens: impl IntoIterator<Item = &'a Token>,
    anchor: &'a Token,
) -> Option<(&'a Token, String)> {
    let mut tokens = tokens.into_iter().collect::<Vec<_>>();
    tokens.sort_by(|left, right| token_reading_order(left, right));

    let maximum_gap = anchor.height.max(18.0) * 5.0 + 24.0;
    let mut passed_anchor = false;
    for token in tokens {
        if std::ptr::eq(token, anchor) {
            passed_anchor = true;
            continue;
        }
        if !passed_anchor {
            continue;
        }
        if token.top - anchor.bottom() > maximum_gap {
            break;
        }
        if token
            .parts
            .iter()
            .chain(std::iter::once(&token.text))
            .any(|value| {
                looks_like_schedule_metadata(value)
                    || section_range_from_text(value).is_some()
                    || weekday_from_schedule_text(value).is_some()
            })
        {
            break;
        }
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if let Some(location) = location_from_text(value)
                .or_else(|| compact_location_from_text(value))
            {
                return Some((token, location));
            }
        }
    }
    None
}
'''
traditional = traditional.rstrip() + "\n" + location_after + "\n"
write("traditional_fields.rs", traditional)


# tests.rs: direct parser coverage for list sections, week unions and teacher lists.
tests = read("tests.rs")
extra_tests = r'''

    #[test]
    fn parses_listed_sections_and_week_unions() {
        assert_eq!(section_range_from_text("周五第10,11,12节第6-8周"), Some((10, 12)));
        assert_eq!(section_range_from_text("周一第1，2节第1-17周"), Some((1, 2)));

        let (weeks, parity, used_default) =
            parse_weeks_and_parity("周四第8,9节第1周，第3-17周");
        assert!(!used_default);
        assert_eq!(parity, "all");
        assert_eq!(weeks, (1..=17).collect::<Vec<_>>());

        let (weeks, parity, used_default) =
            parse_weeks_and_parity("周五第3,4节第2周，第6-16周双周");
        assert!(!used_default);
        assert_eq!(parity, "even");
        assert_eq!(weeks, vec![2, 6, 8, 10, 12, 14, 16]);
    }

    #[test]
    fn accepts_multiple_teacher_names_but_rejects_week_labels() {
        assert!(is_bare_teacher_name("张三/李四"));
        assert!(is_bare_teacher_name("张三、李四"));
        assert!(!is_bare_teacher_name("周单周"));
        assert!(!is_bare_teacher_name("现上课时间地点教师"));
    }
'''
last = tests.rfind("\n}")
if last < 0:
    raise RuntimeError("tests module closing brace not found")
tests = tests[:last] + extra_tests + tests[last:]
write("tests.rs", tests)


# table_structure_tests.rs: full synthetic reproduction of one OCR box containing two courses.
table_tests = read("table_structure_tests.rs")
table_tests = replace_once(
    table_tests,
    "let bottom = timetable_content_bottom(&sections, 1000);",
    "let bottom = timetable_content_bottom(&[], &sections, 1000);",
    "existing table bottom test",
)
extra_table_tests = r'''

    #[test]
    fn strict_section_markers_ignore_schedule_text_in_monday_column() {
        let mut tokens = vec![
            sized_token("星期一", 190.0, 40.0, 80.0, 24.0),
            sized_token("星期二", 390.0, 40.0, 80.0, 24.0),
            sized_token("星期三", 590.0, 40.0, 80.0, 24.0),
            sized_token("周一第1,2节第1-17周", 130.0, 155.0, 170.0, 22.0),
        ];
        for section in 1..=12 {
            tokens.push(sized_token(
                &format!("第{section}节"),
                25.0,
                100.0 + (section as f32 - 1.0) * 50.0,
                45.0,
                22.0,
            ));
        }
        let sections = section_markers(&tokens, 800);
        assert_eq!(sections.len(), 12);
        assert!((sections[0].1 - 111.0).abs() < 1.0);
        assert!((sections[1].1 - 161.0).abs() < 1.0);
    }

    #[test]
    fn one_multiline_ocr_box_yields_two_courses_without_footer_rows() {
        let mut raw_tokens = vec![
            sized_token("星期一", 190.0, 40.0, 80.0, 24.0),
            sized_token("星期二", 390.0, 40.0, 80.0, 24.0),
            sized_token("星期三", 590.0, 40.0, 80.0, 24.0),
            sized_token(
                "课程甲（混合式）\n周一第1,2节第1-17周\n张三\n教3-201\n课程乙实验\n周一第1,2节第2周，第6-16周双周\n李四/王五\n教3-202",
                120.0,
                105.0,
                150.0,
                280.0,
            ),
            sized_token("实践课信息", 120.0, 730.0, 100.0, 22.0),
            sized_token("先修模块", 120.0, 758.0, 90.0, 22.0),
            sized_token("周一第10,11,12节第5周", 120.0, 786.0, 190.0, 22.0),
        ];
        for section in 1..=12 {
            raw_tokens.push(sized_token(
                &format!("第{section}节"),
                25.0,
                100.0 + (section as f32 - 1.0) * 50.0,
                45.0,
                22.0,
            ));
        }

        let tokens = expand_multiline_tokens(raw_tokens);
        let headers = weekday_headers(&tokens);
        let sections = section_markers(&tokens, 800);
        let bottom = timetable_content_bottom(&tokens, &sections, 1000);
        let table_tokens = tokens
            .into_iter()
            .filter(|token| token.center_y() <= bottom)
            .collect::<Vec<_>>();
        let anchors = course_anchors(&table_tokens);
        let (courses, _) = anchor_courses(&table_tokens, &anchors, &headers, 800, 1000);

        assert_eq!(anchors.len(), 2);
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].name, "课程甲（混合式）");
        assert_eq!(courses[0].start_section, 1);
        assert_eq!(courses[0].end_section, 2);
        assert_eq!(courses[0].teacher.as_deref(), Some("张三"));
        assert_eq!(courses[0].location.as_deref(), Some("教3-201"));
        assert_eq!(courses[1].name, "课程乙实验");
        assert_eq!(courses[1].weeks, vec![2, 6, 8, 10, 12, 14, 16]);
        assert_eq!(courses[1].teacher.as_deref(), Some("李四/王五"));
        assert_eq!(courses[1].location.as_deref(), Some("教3-202"));
        assert!(courses.iter().all(|course| course.name != "先修模块"));
    }
'''
last = table_tests.rfind("\n}")
if last < 0:
    raise RuntimeError("table tests module closing brace not found")
table_tests = table_tests[:last] + extra_table_tests + table_tests[last:]
write("table_structure_tests.rs", table_tests)
