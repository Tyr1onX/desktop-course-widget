from pathlib import Path

BRANCH_FILES = {
    "runtime": Path("src-tauri/src/native_ocr/runtime.rs"),
    "grid": Path("src-tauri/src/native_ocr/grid.rs"),
    "courses": Path("src-tauri/src/native_ocr/courses.rs"),
    "metadata": Path("src-tauri/src/native_ocr/metadata.rs"),
    "module": Path("src-tauri/src/native_ocr.rs"),
    "tests": Path("src-tauri/src/native_ocr/table_structure_tests.rs"),
}


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one {label}, found {count}")
    return text.replace(old, new, 1)


runtime = BRANCH_FILES["runtime"].read_text(encoding="utf-8")
runtime = replace_once(
    runtime,
    'const RECOGNIZER_VERSION: &str = "ocr-rs-mnn-ppocrv5-mobile-v3";',
    'const RECOGNIZER_VERSION: &str = "ocr-rs-mnn-ppocrv5-mobile-v4";',
    "recognizer version",
)
runtime = replace_once(
    runtime,
    '''    let anchors = course_anchors(tokens);
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
    );''',
    '''    // A traditional timetable can be followed by transfer, internship and credit tables.
    // When real section markers are available, stop at the lower edge of section 12 instead
    // of feeding the whole long screenshot into the course parser.
    let content_bottom = if sections_inferred {
        working_height as f32 * 0.98
    } else {
        timetable_content_bottom(&sections, working_height)
    };
    let table_tokens = tokens
        .iter()
        .filter(|token| token.center_y() <= content_bottom)
        .cloned()
        .collect::<Vec<_>>();

    let anchors = course_anchors(&table_tokens);
    let (anchored_courses, mut warnings) = anchor_courses(
        &table_tokens,
        &anchors,
        &headers,
        working_width,
        working_height,
    );
    let fallback = fallback_courses(
        &table_tokens,
        &headers,
        &sections,
        working_width,
        working_height,
    );''',
    "table token boundary",
)
BRANCH_FILES["runtime"].write_text(runtime, encoding="utf-8", newline="\n")


grid = BRANCH_FILES["grid"].read_text(encoding="utf-8")
grid = replace_once(
    grid,
    "    has_name && (has_supporting_field || group.len() >= 2)\n}",
    "    has_name && (has_supporting_field || group.iter().any(token_starts_course_card))\n}",
    "fallback evidence rule",
)
TABLE_BOTTOM = r'''fn timetable_content_bottom(sections: &[(u8, f32)], image_height: u32) -> f32 {
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

    (last_center + row_height * 0.65)
        .max(last_center)
        .min(image_height as f32 * 0.995)
}

'''
grid = replace_once(
    grid,
    "fn section_number_from_text(value: &str) -> Option<u8> {",
    TABLE_BOTTOM + "fn section_number_from_text(value: &str) -> Option<u8> {",
    "table bottom helper insertion",
)
BRANCH_FILES["grid"].write_text(grid, encoding="utf-8", newline="\n")


courses = BRANCH_FILES["courses"].read_text(encoding="utf-8")
courses = replace_once(
    courses,
    "    let (name_token, name) = find_course_name(candidates.iter().copied())?;",
    "    let (name_token, name) = find_course_name(candidates.iter().copied(), anchor)?;",
    "course name call",
)
BRANCH_FILES["courses"].write_text(courses, encoding="utf-8", newline="\n")


metadata = BRANCH_FILES["metadata"].read_text(encoding="utf-8")
start = metadata.index("fn weekday_column_bounds(")
end = metadata.index("\nfn nearest_section", start)
NEW_BOUNDS = r'''fn weekday_column_bounds(headers: &[WeekdayHeader], weekday: u8, image_width: f32) -> (f32, f32) {
    let Some(index) = headers.iter().position(|header| header.weekday == weekday) else {
        return (0.0, image_width);
    };
    if headers.len() == 1 {
        return (0.0, image_width);
    }

    let current = &headers[index];
    let step_from = |left: &WeekdayHeader, right: &WeekdayHeader| {
        let weekday_delta = right.weekday.saturating_sub(left.weekday).max(1) as f32;
        ((right.center_x - left.center_x) / weekday_delta).abs()
    };
    let left_step = index
        .checked_sub(1)
        .map(|previous| step_from(&headers[previous], current))
        .or_else(|| headers.get(index + 1).map(|next| step_from(current, next)))
        .unwrap_or(image_width);
    let right_step = headers
        .get(index + 1)
        .map(|next| step_from(current, next))
        .or_else(|| index.checked_sub(1).map(|previous| step_from(&headers[previous], current)))
        .unwrap_or(image_width);

    (
        (current.center_x - left_step / 2.0).max(0.0),
        (current.center_x + right_step / 2.0).min(image_width),
    )
}
'''
metadata = metadata[:start] + NEW_BOUNDS + metadata[end:]

start = metadata.index("fn find_course_name<'a>(")
end = metadata.index("\nfn has_course_code", start)
NEW_NAME = r'''fn find_course_name<'a>(
    tokens: impl IntoIterator<Item = &'a Token>,
    anchor: &'a Token,
) -> Option<(&'a Token, String)> {
    let mut tokens = tokens.into_iter().collect::<Vec<_>>();
    tokens.sort_by(|left, right| token_reading_order(left, right));

    // Coded card titles are already strong and should not be merged with neighbouring text.
    for token in &tokens {
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if let Some(name) = course_name_from_text(value) {
                if has_course_code(&name) {
                    return Some((*token, name));
                }
            }
        }
    }

    // In grid timetables the title is normally one or more consecutive lines immediately
    // above the line containing weekday, sections and weeks. Rebuild those lines before
    // falling back to single-token heuristics.
    let before_anchor = tokens
        .iter()
        .filter(|token| token.center_y() < anchor.center_y() - 1.0)
        .filter_map(|token| name_fragment_from_token(token).map(|name| (*token, name)))
        .collect::<Vec<_>>();
    if let Some((last_token, _)) = before_anchor.last() {
        let anchor_gap = anchor.top - last_token.bottom();
        let anchor_tolerance = anchor.height.max(last_token.height).max(18.0) * 2.8 + 12.0;
        if anchor_gap <= anchor_tolerance {
            let mut first_index = before_anchor.len() - 1;
            while first_index > 0 && before_anchor.len() - first_index < 4 {
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

            let fragments = before_anchor[first_index..]
                .iter()
                .map(|(_, name)| name.clone())
                .collect::<Vec<_>>();
            let combined = join_course_name_fragments(&fragments);
            if let Some(name) = course_name_from_text(&combined) {
                return Some((before_anchor[first_index].0, name));
            }
        }
    }

    // Some mobile card styles put the schedule line before the title. Preserve the existing
    // single-token fallback for those layouts, but prefer values that are not bare names.
    for token in &tokens {
        if let Some(name) = name_fragment_from_token(token) {
            if !is_bare_teacher_name(&name) {
                return Some((*token, name));
            }
        }
    }
    for token in tokens {
        if let Some(name) = name_fragment_from_token(token) {
            return Some((token, name));
        }
    }
    None
}

fn name_fragment_from_token(token: &Token) -> Option<String> {
    for value in &token.parts {
        if let Some(name) = course_name_from_text(value) {
            return Some(name);
        }
    }
    course_name_from_text(&token.text)
}

fn join_course_name_fragments(fragments: &[String]) -> String {
    let mut joined = String::new();
    for fragment in fragments {
        if fragment.is_empty() {
            continue;
        }
        let needs_space = joined
            .chars()
            .last()
            .zip(fragment.chars().next())
            .is_some_and(|(left, right)| left.is_ascii_alphanumeric() && right.is_ascii_alphanumeric());
        if needs_space {
            joined.push(' ');
        }
        joined.push_str(fragment);
    }
    normalize_trailing_course_code(&joined)
}
'''
metadata = metadata[:start] + NEW_NAME + metadata[end:]
metadata = replace_once(
    metadata,
    '        "中心",\n',
    '        "中心",\n        "操场",\n',
    "sports field location marker",
)
metadata = replace_once(
    metadata,
    '        "学期",\n',
    '        "学期",\n        "学分",\n        "起止周",\n        "上课时间",\n        "申请时间",\n        "编号",\n        "调停课信息",\n        "调、停（补）课信息",\n',
    "non-course table headers",
)
BRANCH_FILES["metadata"].write_text(metadata, encoding="utf-8", newline="\n")


module = BRANCH_FILES["module"].read_text(encoding="utf-8")
module = replace_once(
    module,
    'include!("native_ocr/weekday_header_tests.rs");',
    'include!("native_ocr/weekday_header_tests.rs");\ninclude!("native_ocr/table_structure_tests.rs");',
    "table structure test include",
)
BRANCH_FILES["module"].write_text(module, encoding="utf-8", newline="\n")


TESTS = r'''#[cfg(test)]
mod table_structure_tests {
    use super::*;

    fn sized_token(text: &str, left: f32, top: f32, width: f32, height: f32) -> Token {
        Token::from_text(text, 0.98, left, top, width, height).unwrap()
    }

    fn basic_headers() -> Vec<WeekdayHeader> {
        vec![
            WeekdayHeader { weekday: 1, center_x: 190.0, bottom: 80.0 },
            WeekdayHeader { weekday: 2, center_x: 390.0, bottom: 80.0 },
            WeekdayHeader { weekday: 3, center_x: 590.0, bottom: 80.0 },
        ]
    }

    #[test]
    fn table_bottom_stops_before_following_metadata_tables() {
        let sections = (1..=12)
            .map(|section| (section, 120.0 + (section as f32 - 1.0) * 50.0))
            .collect::<Vec<_>>();
        let bottom = timetable_content_bottom(&sections, 1000);
        assert!(bottom > 690.0 && bottom < 710.0);

        let tokens = vec![
            sized_token("计算机问题求解：使", 120.0, 170.0, 150.0, 22.0),
            sized_token("用算法（混合式）", 120.0, 196.0, 150.0, 22.0),
            sized_token("周一第3-4节第1-17周", 120.0, 224.0, 170.0, 22.0),
            sized_token("毛毅", 120.0, 252.0, 50.0, 22.0),
            sized_token("教3-201", 120.0, 278.0, 70.0, 22.0),
            sized_token("上课时间", 120.0, 760.0, 90.0, 22.0),
            sized_token("周一第10-12节第5周", 120.0, 786.0, 180.0, 22.0),
            sized_token("学分", 120.0, 820.0, 50.0, 22.0),
            sized_token("起止周", 120.0, 846.0, 70.0, 22.0),
        ];
        let table_tokens = tokens
            .into_iter()
            .filter(|token| token.center_y() <= bottom)
            .collect::<Vec<_>>();
        let anchors = course_anchors(&table_tokens);
        let (courses, _) = anchor_courses(&table_tokens, &anchors, &basic_headers(), 800, 1000);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "计算机问题求解：使用算法（混合式）");
        assert!(courses.iter().all(|course| !matches!(course.name.as_str(), "上课时间" | "学分" | "起止周")));
    }

    #[test]
    fn reconstructs_multiline_title_before_schedule_anchor() {
        let tokens = vec![
            sized_token("人工智能导论及其", 120.0, 120.0, 160.0, 22.0),
            sized_token("Python应用实践", 120.0, 146.0, 160.0, 22.0),
            sized_token("周三第1-2节第1-17周", 120.0, 174.0, 180.0, 22.0),
            sized_token("左益平", 120.0, 202.0, 60.0, 22.0),
            sized_token("教3-511", 120.0, 228.0, 70.0, 22.0),
        ];
        let anchors = course_anchors(&tokens);
        let (courses, _) = anchor_courses(&tokens, &anchors, &basic_headers(), 800, 500);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "人工智能导论及其Python应用实践");
    }

    #[test]
    fn title_before_anchor_wins_over_teacher_and_sports_location() {
        let tokens = vec![
            sized_token("男生网球", 520.0, 150.0, 90.0, 22.0),
            sized_token("周三第6-7节第1-17周", 520.0, 178.0, 180.0, 22.0),
            sized_token("凌勇", 520.0, 206.0, 50.0, 22.0),
            sized_token("操场A", 520.0, 232.0, 70.0, 22.0),
        ];
        let anchors = course_anchors(&tokens);
        let (courses, _) = anchor_courses(&tokens, &anchors, &basic_headers(), 800, 500);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "男生网球");
        assert_eq!(courses[0].location.as_deref(), Some("操场A"));
    }

    #[test]
    fn weekday_edges_do_not_include_the_left_time_column() {
        let headers = basic_headers();
        assert_eq!(weekday_column_bounds(&headers, 1, 800), (90.0, 290.0));
        assert_eq!(weekday_column_bounds(&headers, 3, 800), (490.0, 690.0));
    }

    #[test]
    fn arbitrary_two_line_fields_are_not_course_cards() {
        let group = vec![
            sized_token("学分", 120.0, 120.0, 50.0, 22.0),
            sized_token("起止周", 120.0, 148.0, 70.0, 22.0),
        ];
        assert!(!group_has_card_body(&group));
    }
}
'''
BRANCH_FILES["tests"].write_text(TESTS, encoding="utf-8", newline="\n")
