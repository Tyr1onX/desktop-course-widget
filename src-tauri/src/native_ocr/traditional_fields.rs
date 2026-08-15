fn find_teacher_after_schedule<'a>(
    tokens: impl IntoIterator<Item = &'a Token>,
    course_name: &str,
    anchor: &'a Token,
) -> Option<(&'a Token, String)> {
    let mut tokens = tokens.into_iter().collect::<Vec<_>>();
    tokens.sort_by(|left, right| token_reading_order(left, right));

    let maximum_gap = anchor.height.max(18.0) * 3.2 + 12.0;
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

        let values = token.parts.iter().chain(std::iter::once(&token.text));
        for value in values {
            let compact = compact_text(value);
            if compact.is_empty() {
                continue;
            }
            if compact_location_from_text(&compact).is_some() || is_location_text(&compact) {
                return None;
            }
            if looks_like_schedule_metadata(&compact)
                || section_range_from_text(&compact).is_some()
                || matches!(compact.as_str(), "单周" | "双周" | "单双周")
            {
                continue;
            }
            if let Some(teacher) = bare_teacher_from_text(&compact, course_name) {
                return Some((token, teacher));
            }
        }
    }
    None
}

fn find_compact_location<'a>(
    tokens: impl IntoIterator<Item = &'a Token>,
) -> Option<(&'a Token, String)> {
    for token in tokens {
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if let Some(location) = compact_location_from_text(value) {
                return Some((token, location));
            }
        }
    }
    None
}

fn compact_location_from_text(value: &str) -> Option<String> {
    let compact = compact_text(value)
        .trim_matches([':', '：', '，', ',', '。', '；', ';'])
        .to_owned();
    if compact.is_empty() {
        return None;
    }

    let room = Regex::new(
        r"^(?:教|综|实|实验|实训|逸夫|文|理|工|体)[A-Za-z]?\d{0,2}[-－—–]\d{2,4}$",
    )
    .unwrap();
    if room.is_match(&compact) {
        return Some(compact);
    }

    let sports = Regex::new(r"^(?:操场|体育场|体育馆)[A-Za-z0-9一二三四五六七八九十]*$").unwrap();
    sports.is_match(&compact).then_some(compact)
}

fn location_suffix_after_section(value: &str) -> Option<String> {
    let compact = compact_text(value);
    let section = Regex::new(
        r"(?:第?\d{1,2}(?:(?:[,，、.·/]|第)\d{1,2})+节|第?\d{1,2}节(?:[-—~－–‑]+|至|到)第?\d{1,2}节?|第?\d{1,2}(?:[-—~－–‑]+|至|到)第?\d{1,2}节)",
    )
    .unwrap();

    for matched in section.find_iter(&compact) {
        let suffix = compact[matched.end()..]
            .trim_start_matches([',', '，', ';', '；', '|', '·', ':', '：']);
        if suffix.is_empty() || matches!(suffix, "无" | "暂无" | "未安排") {
            continue;
        }
        if let Some(location) =
            location_from_text(suffix).or_else(|| compact_location_from_text(suffix))
        {
            return Some(location);
        }
    }
    None
}

fn find_location_in_schedule_token(anchor: &Token) -> Option<(&Token, String)> {
    for value in anchor.parts.iter().chain(std::iter::once(&anchor.text)) {
        if let Some(location) = location_suffix_after_section(value) {
            return Some((anchor, location));
        }
        let compact = compact_text(value);
        for segment in compact.split([',', '，', ';', '；', '|', '·']).rev() {
            if let Some(location) = location_from_text(segment) {
                return Some((anchor, location));
            }
        }
    }
    None
}

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
