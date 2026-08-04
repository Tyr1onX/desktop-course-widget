fn course_anchors(tokens: &[Token]) -> Vec<CourseAnchor> {
    let anchor = Regex::new(
        r"(?:周|星期)([一二三四五六日天]).*?第?\s*(\d{1,2})\s*(?:节\s*)?[-—~至]\s*第?\s*(\d{1,2})\s*节",
    )
    .unwrap();
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

fn find_fragment<'a>(
    tokens: impl IntoIterator<Item = &'a Token>,
    predicate: impl Fn(&str) -> bool,
) -> Option<(&'a Token, String)> {
    for token in tokens {
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if predicate(value) {
                return Some((token, value.clone()));
            }
        }
    }
    None
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
        r"^(?:(?:周|星期)[一二三四五六日天])?(?:(?:第?\d{1,2}节(?:[-—~至]第?\d{1,2}节)?)|(?:第?\d{1,2}(?:[-—~至]第?\d{1,2})?节)|节)?(?:\d{1,2}(?:[-—~至]\d{1,2})?周(?:[（(][单双][)）])?)?[，,、;；:：·|\-]*",
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
) -> Option<(&'a Token, String)> {
    for token in tokens {
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if let Some(name) = course_name_from_text(value) {
                return Some((token, name));
            }
        }
    }
    None
}

fn course_name_from_text(value: &str) -> Option<String> {
    let mut candidate = compact_text(value)
        .trim_matches(|character: char| {
            character.is_ascii_punctuation()
                || matches!(character, '（' | '）' | '【' | '】' | '，' | '。' | '：' | '；')
        })
        .to_owned();
    if candidate.is_empty()
        || is_weekday_header(&candidate)
        || section_number_from_text(&candidate).is_some()
        || is_time_text(&candidate)
        || is_teacher_text(&candidate)
        || is_location_text(&candidate)
        || is_common_header(&candidate)
    {
        return None;
    }

    let schedule_markers = [
        "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日",
        "星期天", "周一", "周二", "周三", "周四", "周五", "周六", "周日", "周天",
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
