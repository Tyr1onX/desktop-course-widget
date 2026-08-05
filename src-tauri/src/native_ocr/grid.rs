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
                && groups.last().is_some_and(|group| group.iter().any(token_starts_course_card));
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
            let parsed_range = section_range_from_text(&combined);
            let parsed_weekday = weekday_from_schedule_text(&combined).unwrap_or(header.weekday);
            let (
                weekday,
                start_section,
                end_section,
                weeks,
                parity,
                used_default_weeks,
                anchor,
            ) = if let Some(parsed) = parsed_anchors.first() {
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
                let (start_section, end_section) =
                    parsed_range.unwrap_or((positional_start, positional_end));
                (
                    parsed_weekday,
                    start_section,
                    end_section,
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
    let mut has_name = false;
    let mut has_supporting_field = false;
    for token in group {
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if course_name_from_text(value).is_some() {
                has_name = true;
            }
            if is_teacher_text(value)
                || is_location_text(value)
                || looks_like_schedule_metadata(value)
            {
                has_supporting_field = true;
            }
        }
    }
    has_name && (has_supporting_field || group.iter().any(token_starts_course_card))
}

fn weekday_headers(tokens: &[Token]) -> Vec<WeekdayHeader> {
    #[derive(Clone)]
    struct Candidate {
        header: WeekdayHeader,
        center_y: f32,
        height: f32,
    }

    let mut candidates = tokens
        .iter()
        .filter_map(|token| {
            weekday_from_text(&token.text).map(|weekday| Candidate {
                header: WeekdayHeader {
                    weekday,
                    center_x: token.center_x(),
                    bottom: token.bottom(),
                },
                center_y: token.center_y(),
                height: token.height.max(1.0),
            })
        })
        .collect::<Vec<_>>();

    // OCR may return `星期` and the final weekday character as separate boxes.
    for (prefix_index, prefix) in tokens.iter().enumerate() {
        let prefix_text = compact_text(&prefix.text);
        if prefix_text != "星期" && prefix_text != "周" {
            continue;
        }
        for (suffix_index, suffix) in tokens.iter().enumerate() {
            if prefix_index == suffix_index {
                continue;
            }
            let suffix_text = compact_text(&suffix.text);
            if suffix_text.chars().count() != 1 {
                continue;
            }
            let Some(weekday) = suffix_text.chars().next().and_then(weekday_character) else {
                continue;
            };
            let height = prefix.height.max(suffix.height).max(1.0);
            if (prefix.center_y() - suffix.center_y()).abs() > height * 0.8 + 4.0 {
                continue;
            }
            let horizontal_gap = suffix.left - prefix.right();
            if horizontal_gap < -height * 0.25 || horizontal_gap > height * 1.8 + 8.0 {
                continue;
            }
            let left = prefix.left.min(suffix.left);
            let right = prefix.right().max(suffix.right());
            let top = prefix.top.min(suffix.top);
            let bottom = prefix.bottom().max(suffix.bottom());
            candidates.push(Candidate {
                header: WeekdayHeader {
                    weekday,
                    center_x: (left + right) / 2.0,
                    bottom,
                },
                center_y: (top + bottom) / 2.0,
                height: (bottom - top).max(1.0),
            });
        }
    }

    let mut best_headers = Vec::new();
    let mut best_is_monotonic = false;
    let mut best_center_y = f32::MAX;
    let mut best_span = 0.0_f32;

    for seed in &candidates {
        let mut by_weekday: [Option<&Candidate>; 7] = std::array::from_fn(|_| None);
        for candidate in &candidates {
            let tolerance = seed.height.max(candidate.height) * 1.35 + 6.0;
            if (seed.center_y - candidate.center_y).abs() > tolerance {
                continue;
            }
            let slot = &mut by_weekday[(candidate.header.weekday - 1) as usize];
            let candidate_distance = (candidate.center_y - seed.center_y).abs();
            let should_replace = slot.is_none_or(|existing| {
                candidate_distance < (existing.center_y - seed.center_y).abs()
            });
            if should_replace {
                *slot = Some(candidate);
            }
        }

        let mut row = by_weekday
            .into_iter()
            .flatten()
            .map(|candidate| candidate.header.clone())
            .collect::<Vec<_>>();
        row.sort_by(|left, right| {
            left.center_x
                .partial_cmp(&right.center_x)
                .unwrap_or(Ordering::Equal)
        });
        let is_monotonic = row
            .windows(2)
            .all(|pair| pair[0].weekday < pair[1].weekday);
        let span = row
            .last()
            .zip(row.first())
            .map(|(last, first)| last.center_x - first.center_x)
            .unwrap_or_default();

        let is_better = row.len() > best_headers.len()
            || (row.len() == best_headers.len() && is_monotonic && !best_is_monotonic)
            || (row.len() == best_headers.len()
                && is_monotonic == best_is_monotonic
                && seed.center_y < best_center_y)
            || (row.len() == best_headers.len()
                && is_monotonic == best_is_monotonic
                && (seed.center_y - best_center_y).abs() < 1.0
                && span > best_span);
        if is_better {
            best_headers = row;
            best_is_monotonic = is_monotonic;
            best_center_y = seed.center_y;
            best_span = span;
        }
    }

    best_headers
}

fn section_markers(tokens: &[Token], image_width: u32) -> Vec<(u8, f32)> {
    let mut detected = tokens
        .iter()
        .filter(|token| token.center_x() < image_width as f32 * 0.18)
        .filter_map(|token| {
            section_number_from_text(&token.text).map(|section| (section, token.center_y()))
        })
        .collect::<Vec<_>>();
    detected.sort_by_key(|(section, _)| *section);
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

fn timetable_content_bottom(sections: &[(u8, f32)], image_height: u32) -> f32 {
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
