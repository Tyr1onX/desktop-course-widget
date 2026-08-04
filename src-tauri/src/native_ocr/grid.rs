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
                    && section_number_from_text(&token.text).is_none()
                    && !is_time_text(&token.text)
            })
            .cloned()
            .collect::<Vec<_>>();
        column_tokens.sort_by(token_reading_order);
        let mut groups: Vec<Vec<Token>> = Vec::new();
        for token in column_tokens {
            let starts_named_card = token_starts_course_card(&token)
                && groups.last().is_some_and(|group| group_has_card_body(group));
            let starts_new = starts_named_card
                || groups
                    .last()
                    .and_then(|group| group.last())
                    .is_some_and(|previous| {
                        let vertical_gap = token.top - previous.bottom();
                        let typical_height = previous.height.max(token.height).max(18.0);
                        vertical_gap > typical_height * 1.15
                            || nearest_section(sections, token.center_y())
                                > nearest_section(sections, previous.center_y()).saturating_add(2)
                    });
            if starts_new || groups.is_empty() {
                groups.push(vec![token]);
            } else if let Some(group) = groups.last_mut() {
                group.push(token);
            }
        }

        for group in groups {
            if !group_has_card_body(&group) {
                continue;
            }
            let combined = group
                .iter()
                .map(|token| token.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let parsed_anchors = course_anchors(&group);
            let first_y = group.first().map(Token::center_y).unwrap_or_default();
            let last_y = group.last().map(Token::center_y).unwrap_or(first_y);
            let positional_start = nearest_section(sections, first_y);
            let positional_end = nearest_section(sections, last_y).max(positional_start);
            let fallback_weeks = parse_weeks_and_parity(&combined);
            let (weekday, start_section, end_section, weeks, parity, used_default_weeks, anchor) =
                if let Some(parsed) = parsed_anchors.first() {
                    (
                        parsed.weekday,
                        parsed.start_section,
                        parsed.end_section,
                        parsed.weeks.clone(),
                        parsed.parity.clone(),
                        parsed.used_default_weeks,
                        &group[parsed.token_index],
                    )
                } else {
                    let Some(anchor) = group.first() else {
                        continue;
                    };
                    (
                        header.weekday,
                        positional_start,
                        positional_end,
                        fallback_weeks.0,
                        fallback_weeks.1,
                        fallback_weeks.2,
                        anchor,
                    )
                };
            if let Some(course) = course_from_block(
                weekday,
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

fn token_starts_course_card(token: &Token) -> bool {
    token
        .parts
        .iter()
        .chain(std::iter::once(&token.text))
        .filter_map(|value| course_name_from_text(value))
        .any(|name| has_course_code(&name))
}

fn group_has_card_body(group: &[Token]) -> bool {
    group.iter().any(|token| {
        token
            .parts
            .iter()
            .chain(std::iter::once(&token.text))
            .any(|value| {
                is_location_text(value)
                    || looks_like_schedule_metadata(value)
                    || course_name_from_text(value).is_some_and(|name| has_course_code(&name))
            })
    })
}

fn weekday_headers(tokens: &[Token]) -> Vec<WeekdayHeader> {
    let top_limit = tokens
        .iter()
        .map(|token| token.top)
        .fold(f32::MAX, f32::min)
        + tokens
            .iter()
            .map(|token| token.height)
            .fold(0.0_f32, f32::max)
            * 5.0;
    let mut headers = tokens
        .iter()
        .filter(|token| token.top <= top_limit)
        .filter_map(|token| {
            weekday_from_text(&token.text).map(|weekday| WeekdayHeader {
                weekday,
                center_x: token.center_x(),
                bottom: token.bottom(),
            })
        })
        .collect::<Vec<_>>();
    headers.sort_by(|left, right| {
        left.center_x
            .partial_cmp(&right.center_x)
            .unwrap_or(Ordering::Equal)
    });
    headers.dedup_by_key(|header| header.weekday);
    headers
}

fn section_markers(tokens: &[Token], image_width: u32) -> Vec<(u8, f32)> {
    let mut markers = tokens
        .iter()
        .filter(|token| token.center_x() < image_width as f32 * 0.18)
        .filter_map(|token| {
            section_number_from_text(&token.text).map(|section| (section, token.center_y()))
        })
        .collect::<Vec<_>>();
    markers.sort_by_key(|(section, _)| *section);
    markers.dedup_by_key(|(section, _)| *section);
    markers
}

fn section_number_from_text(value: &str) -> Option<u8> {
    let compact = compact_text(value);
    if compact.is_empty() || is_time_text(&compact) {
        return None;
    }
    if let Ok(section) = compact.parse::<u8>() {
        return (1..=20).contains(&section).then_some(section);
    }

    let labelled = Regex::new(r"^第?(\d{1,2})(?:节|课)").unwrap();
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
}

fn infer_section_markers(
    tokens: &[Token],
    headers: &[WeekdayHeader],
    image_height: u32,
) -> Vec<(u8, f32)> {
    let header_bottom = headers
        .iter()
        .map(|header| header.bottom)
        .fold(0.0_f32, f32::max);
    let content_bottom = tokens
        .iter()
        .filter(|token| token.top > header_bottom)
        .map(Token::bottom)
        .fold(header_bottom, f32::max)
        .max(image_height as f32 * 0.72)
        .min(image_height as f32 * 0.98);
    let usable_height = (content_bottom - header_bottom).max(DEFAULT_SECTION_COUNT as f32 * 24.0);
    let row_height = usable_height / DEFAULT_SECTION_COUNT as f32;
    (1..=DEFAULT_SECTION_COUNT)
        .map(|section| {
            (
                section,
                header_bottom + row_height * (section as f32 - 0.5),
            )
        })
        .collect()
}
