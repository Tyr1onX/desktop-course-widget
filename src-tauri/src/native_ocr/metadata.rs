fn course_anchors(tokens: &[Token]) -> Vec<CourseAnchor> {
    let mut anchors = tokens
        .iter()
        .enumerate()
        .filter_map(|(token_index, _token)| {
            let metadata_text = schedule_text_for_anchor(tokens, token_index);
            let weekday = weekday_from_schedule_text(&metadata_text)?;
            let (start_section, end_section) = section_range_from_text(&metadata_text)?;
            let (weeks, parity, used_default_weeks) = parse_weeks_and_parity(&metadata_text);
            Some(CourseAnchor {
                token_index,
                weekday,
                start_section,
                end_section,
                weeks,
                parity,
                used_default_weeks,
                metadata_text,
            })
        })
        .collect::<Vec<_>>();

    // Some OCR results keep the weekday and section range but lose the final week range.
    // Prefer the semester maximum observed elsewhere in the same timetable instead of
    // silently truncating those courses to DEFAULT_LAST_WEEK.
    let detected_last_week = anchors
        .iter()
        .filter(|anchor| !anchor.used_default_weeks)
        .flat_map(|anchor| anchor.weeks.iter().copied())
        .max()
        .unwrap_or(DEFAULT_LAST_WEEK);
    for anchor in &mut anchors {
        if anchor.used_default_weeks && detected_last_week > DEFAULT_LAST_WEEK {
            anchor.weeks = (1..=detected_last_week).collect();
        }
    }

    anchors.sort_by(|left, right| {
        left.weekday
            .cmp(&right.weekday)
            .then(left.start_section.cmp(&right.start_section))
            .then_with(|| {
                tokens[left.token_index]
                    .top
                    .partial_cmp(&tokens[right.token_index].top)
                    .unwrap_or(Ordering::Equal)
            })
    });
    anchors
}

fn schedule_text_for_anchor(tokens: &[Token], token_index: usize) -> String {
    let anchor = &tokens[token_index];

    // A complete schedule line is authoritative. Extending it with a nearby bare week
    // range can steal the metadata of the next course in a densely stacked grid cell.
    if !parse_weeks_and_parity(&anchor.text).2 {
        return anchor.text.clone();
    }

    let mut combined = anchor.text.clone();
    let maximum_gap = anchor.height.max(18.0) * 3.4 + 16.0;
    let mut continuations = tokens
        .iter()
        .enumerate()
        .filter(|(index, candidate)| {
            *index != token_index
                && candidate.center_y() > anchor.center_y() + 0.5
                && candidate.top - anchor.bottom() <= maximum_gap
        })
        .filter(|(_, candidate)| horizontally_related(anchor, candidate))
        .collect::<Vec<_>>();
    continuations.sort_by(|left, right| token_reading_order(left.1, right.1));

    let mut appended = 0;
    for (_, candidate) in continuations {
        if continuation_has_boundary(tokens, anchor, candidate) {
            break;
        }
        if !looks_like_schedule_continuation(&candidate.text) {
            continue;
        }
        combined.push_str(&candidate.text);
        appended += 1;
        if !parse_weeks_and_parity(&combined).2 || appended >= 2 {
            break;
        }
    }
    combined
}

fn horizontally_related(left: &Token, right: &Token) -> bool {
    let overlap = (left.right().min(right.right()) - left.left.max(right.left)).max(0.0);
    let minimum_width = left.width.min(right.width).max(1.0);
    overlap >= minimum_width * 0.12
        || (left.center_x() - right.center_x()).abs() <= left.width.max(right.width) * 0.55
}

fn continuation_has_boundary(tokens: &[Token], anchor: &Token, candidate: &Token) -> bool {
    tokens.iter().any(|between| {
        between.center_y() > anchor.center_y() + 0.5
            && between.center_y() < candidate.center_y() - 0.5
            && horizontally_related(anchor, between)
            && (weekday_from_schedule_text(&between.text).is_some()
                || section_range_from_text(&between.text).is_some()
                || is_footer_table_header(&between.text)
                || is_teacher_text(&between.text)
                || is_bare_teacher_name(&between.text)
                || is_location_text(&between.text)
                || compact_location_from_text(&between.text).is_some()
                || course_name_from_text(&between.text)
                    .is_some_and(|name| name.chars().count() >= 4))
    })
}

fn looks_like_schedule_continuation(value: &str) -> bool {
    let compact = compact_text(value);
    if compact.is_empty()
        || weekday_from_schedule_text(&compact).is_some()
        || compact_location_from_text(&compact).is_some()
        || is_location_text(&compact)
        || is_footer_table_header(&compact)
    {
        return false;
    }
    let has_digit = compact.chars().any(|character| character.is_ascii_digit());
    let has_week = compact.contains('周');
    let has_parity = compact.contains("单周")
        || compact.contains("双周")
        || compact.contains("周单")
        || compact.contains("周双");
    (has_week && (has_digit || has_parity))
        || (has_digit
            && compact
                .chars()
                .all(|character| {
                    character.is_ascii_digit()
                        || matches!(
                            character,
                            '-' | '—' | '~' | '－' | '–' | '‑' | '第' | '周' | '(' | ')' | '（' | '）'
                        )
                }))
}

fn weekday_from_schedule_text(value: &str) -> Option<u8> {
    let pattern = Regex::new(r"(?:周|星期)([一二三四五六日天1-7])").unwrap();
    let compact = compact_text(value);
    let captures = pattern.captures(&compact)?;
    weekday_character(captures.get(1)?.as_str().chars().next()?)
}

fn section_range_from_text(value: &str) -> Option<(u8, u8)> {
    let compact = compact_text(value);

    let listed = Regex::new(
        r"第?(\d{1,2}(?:(?:[,，、.·/]|第)\d{1,2})+)节",
    )
    .unwrap();
    if let Some(captures) = listed.captures(&compact) {
        let mut sections = Regex::new(r"\d{1,2}")
            .unwrap()
            .find_iter(captures.get(1)?.as_str())
            .filter_map(|value| value.as_str().parse::<u8>().ok())
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
}

fn parse_weeks_and_parity(text: &str) -> (Vec<u8>, String, bool) {
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
}

fn weekday_column_bounds(headers: &[WeekdayHeader], weekday: u8, image_width: f32) -> (f32, f32) {
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

fn find_teacher_fragment<'a>(
    tokens: impl IntoIterator<Item = &'a Token>,
    name_token: &'a Token,
    course_name: &str,
    _anchor: &'a Token,
) -> Option<(&'a Token, String)> {
    let mut tokens = tokens.into_iter().collect::<Vec<_>>();
    tokens.sort_by(|left, right| token_reading_order(left, right));

    for token in &tokens {
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if let Some(teacher) = explicit_teacher_from_text(value) {
                return Some((*token, teacher));
            }
        }
    }

    let name_part = name_token.parts.iter().position(|value| {
        course_name_from_text(value).as_deref() == Some(course_name)
    });
    if let Some(name_part) = name_part {
        for value in name_token.parts.iter().skip(name_part + 1) {
            if is_location_text(value)
                || looks_like_schedule_metadata(value)
                || section_range_from_text(value).is_some()
            {
                break;
            }
            if let Some(teacher) = bare_teacher_from_text(value, course_name) {
                return Some((name_token, teacher));
            }
        }
    }

    let schedule_top = tokens
        .iter()
        .filter(|token| {
            token.parts.iter().chain(std::iter::once(&token.text)).any(|value| {
                looks_like_schedule_metadata(value) || section_range_from_text(value).is_some()
            })
        })
        .map(|token| token.top)
        .fold(f32::MAX, f32::min);
    let schedule_top = if schedule_top.is_finite() {
        schedule_top
    } else {
        name_token.bottom() + name_token.height.max(18.0) * 3.0
    };

    let mut passed_name = false;
    for token in tokens {
        if std::ptr::eq(token, name_token) {
            passed_name = true;
            continue;
        }
        if !passed_name || token.top + 2.0 < name_token.top {
            continue;
        }
        if token.top >= schedule_top - 1.0 {
            break;
        }
        if token.top - name_token.bottom() > name_token.height.max(token.height).max(18.0) * 2.2 {
            break;
        }
        for value in &token.parts {
            if let Some(teacher) = bare_teacher_from_text(value, course_name) {
                return Some((token, teacher));
            }
        }
    }
    None
}

fn explicit_teacher_from_text(value: &str) -> Option<String> {
    let compact = compact_text(value);
    if !is_teacher_text(&compact) {
        return None;
    }
    let prefix = Regex::new(r"^(?:老师|教师)[:：]?").unwrap();
    let suffix = Regex::new(r"(?:老师|教师|教授)$").unwrap();
    let mut candidate = prefix.replace(&compact, "").into_owned();
    candidate = suffix.replace(&candidate, "").into_owned();
    let candidate = candidate.trim_matches([':', '：', '，', ',', '·']).to_owned();
    if is_bare_teacher_name(&candidate) {
        Some(candidate)
    } else if compact.chars().count() <= 12 {
        Some(compact)
    } else {
        None
    }
}

fn bare_teacher_from_text(value: &str, course_name: &str) -> Option<String> {
    let candidate = compact_text(value)
        .trim_matches([':', '：', '，', ',', '·'])
        .to_owned();
    (candidate != course_name && is_bare_teacher_name(&candidate)).then_some(candidate)
}

fn is_bare_teacher_name(value: &str) -> bool {
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
}

fn looks_like_roster_text(value: &str) -> bool {
    let compact = compact_text(value);
    let repeated_class = Regex::new(r"\d{2}[\u{4e00}-\u{9fff}A-Za-z]{1,10}\d{2}")
        .unwrap()
        .find_iter(&compact)
        .count();
    let separators = compact
        .chars()
        .filter(|character| matches!(character, ',' | '，' | '、'))
        .count();
    let digits = compact
        .chars()
        .filter(|character| character.is_ascii_digit())
        .count();
    repeated_class >= 2 || (separators >= 2 && digits >= 6)
}

fn find_location_fragment<'a>(
    tokens: impl IntoIterator<Item = &'a Token>,
) -> Option<(&'a Token, String)> {
    for token in tokens {
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if let Some(location) = location_from_text(value) {
                return Some((token, location));
            }
        }
    }
    None
}

fn location_from_text(value: &str) -> Option<String> {
    let compact = compact_text(value);
    if !is_location_text(&compact) {
        return None;
    }

    let label = Regex::new(r"^地点[:：]?").unwrap();
    let leading_metadata = Regex::new(
        r"^(?:(?:周|星期)[一二三四五六日天1-7])?(?:(?:第?\d{1,2}节(?:(?:[-—~]+|至|到)第?\d{1,2}节)?)|(?:第?\d{1,2}(?:(?:[-—~]+|至|到)第?\d{1,2})?节)|节)?(?:\d{1,2}(?:(?:[-—~]+|至|到)\d{1,2})?周(?:[（(][单双][)）])?)?[，,、;；:：·|\-]*",
    )
    .unwrap();
    let mut candidate = label.replace(&compact, "").into_owned();
    candidate = leading_metadata.replace(&candidate, "").into_owned();

    if let Some(index) = ["老师", "教师", "教授"]
        .iter()
        .filter_map(|marker| candidate.find(marker))
        .min()
    {
        candidate.truncate(index);
    }
    let candidate = candidate
        .trim_matches(|character: char| {
            character.is_ascii_punctuation()
                || matches!(character, '，' | '。' | '：' | '；' | '、' | '·' | '（' | '）')
        })
        .to_owned();
    (!candidate.is_empty() && is_location_text(&candidate)).then_some(candidate)
}

fn find_course_name<'a>(
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

fn has_course_code(value: &str) -> bool {
    Regex::new(r"\[\d{2}\]$").unwrap().is_match(value)
}

fn normalize_trailing_course_code(value: &str) -> String {
    let pattern = Regex::new(
        r"^(.*[\u{4e00}-\u{9fff}].*?)(?:\[|[|丨Il])(\d{2})(?:\]|[|丨Il])?$",
    )
    .unwrap();
    let Some(captures) = pattern.captures(value) else {
        return value.to_owned();
    };
    let base = captures
        .get(1)
        .map(|value| value.as_str().trim())
        .unwrap_or_default();
    let code = captures
        .get(2)
        .map(|value| value.as_str())
        .unwrap_or_default();
    if base.is_empty() || code.is_empty() {
        value.to_owned()
    } else {
        format!("{base}[{code}]")
    }
}

fn strip_traditional_grid_prefix(value: &str) -> String {
    let room_prefix = Regex::new(
        r"^(?:(?:教|综|实|实验|实训|逸夫|文|理|工|体)[A-Za-z]?\d{0,2}[-－—–]\d{2,4}|(?:操场|体育场|体育馆)[A-Za-z0-9一二三四五六七八九十]*)(?:[（(](?:停|调)\d{3,8}[)）])?",
    )
    .unwrap();
    let change_prefix = Regex::new(r"^[（(](?:停|调)\d{3,8}[)）]").unwrap();
    let mut candidate = value.to_owned();
    if let Some(prefix) = room_prefix.find(&candidate) {
        let remainder = candidate[prefix.end()..].trim();
        if remainder.chars().count() >= 2 {
            candidate = remainder.to_owned();
        }
    }
    if let Some(prefix) = change_prefix.find(&candidate) {
        let remainder = candidate[prefix.end()..].trim();
        if remainder.chars().count() >= 2 {
            candidate = remainder.to_owned();
        }
    }
    candidate
}

fn course_name_from_text(value: &str) -> Option<String> {
    let mut candidate = compact_text(value)
        .trim_matches(|character: char| {
            (character.is_ascii_punctuation() && !matches!(character, '[' | ']'))
                || matches!(character, '【' | '】' | '，' | '。' | '：' | '；')
        })
        .to_owned();
    candidate = strip_traditional_grid_prefix(&candidate);
    if candidate.is_empty()
        || weekday_from_text(&candidate).is_some()
        || Regex::new(r"^(?:周|星期)[一二三四五六日天1-7]$")
            .unwrap()
            .is_match(&candidate)
        || section_number_from_text(&candidate).is_some()
        || is_time_text(&candidate)
        || is_teacher_text(&candidate)
        || is_location_text(&candidate)
        || is_common_header(&candidate)
        || looks_like_roster_text(&candidate)
    {
        return None;
    }

    let schedule_markers = [
        "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日",
        "星期天", "星期1", "星期2", "星期3", "星期4", "星期5", "星期6", "星期7",
        "周一", "周二", "周三", "周四", "周五", "周六", "周日", "周天",
        "第1节", "第2节", "第3节", "第4节", "第5节", "第6节", "第7节", "第8节",
        "第9节", "第10节", "第11节", "第12节", "老师", "教师", "教授", "教学楼",
        "教室", "校区", "南湖", "南岭",
    ];
    if let Some(index) = schedule_markers
        .iter()
        .filter_map(|marker| candidate.find(marker))
        .filter(|index| *index > 0)
        .min()
    {
        candidate.truncate(index);
    }

    if candidate.is_empty()
        || weekday_from_text(&candidate).is_some()
        || looks_like_schedule_metadata(&candidate)
        || looks_like_roster_text(&candidate)
    {
        return None;
    }
    candidate = normalize_trailing_course_code(&candidate);

    let character_count = candidate.chars().count();
    let has_name_character = candidate
        .chars()
        .any(|character| character.is_alphabetic() || ('\u{4e00}'..='\u{9fff}').contains(&character));
    if character_count < 2
        || character_count > 60
        || !has_name_character
        || looks_like_schedule_metadata(&candidate)
    {
        return None;
    }
    Some(candidate)
}
