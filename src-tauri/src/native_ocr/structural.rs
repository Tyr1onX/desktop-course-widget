const TALL_SCREENSHOT_ASPECT_RATIO: f32 = 2.2;
const TALL_MIN_WORKING_WIDTH: u32 = 840;
const TALL_MAX_WORKING_HEIGHT: u32 = 3600;
const TALL_MAX_WORKING_PIXELS: u64 = 3_200_000;
const TALL_SOFT_MAX_HEIGHT: u32 = 4800;
const TALL_SOFT_MAX_PIXELS: u64 = 4_200_000;
const TALL_DETECTOR_MAX_SIDE: u32 = 1280;

fn detector_max_side_for_dimensions(width: u32, height: u32) -> u32 {
    if width == 0 || height == 0 {
        return 960;
    }
    let aspect_ratio = height as f32 / width as f32;
    if aspect_ratio >= TALL_SCREENSHOT_ASPECT_RATIO {
        TALL_DETECTOR_MAX_SIDE
    } else {
        960
    }
}

fn working_dimensions(width: u32, height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (width, height);
    }

    let aspect_ratio = height as f32 / width as f32;
    if aspect_ratio < TALL_SCREENSHOT_ASPECT_RATIO {
        let longest = width.max(height);
        if longest <= MAX_IMAGE_SIDE {
            return (width, height);
        }
        let scale = MAX_IMAGE_SIDE as f32 / longest as f32;
        return scaled_dimensions(width, height, scale);
    }

    let total_pixels = width as f64 * height as f64;
    let pixel_scale = ((TALL_MAX_WORKING_PIXELS as f64 / total_pixels).sqrt() as f32).min(1.0);
    let height_scale = (TALL_MAX_WORKING_HEIGHT as f32 / height as f32).min(1.0);
    let mut scale = pixel_scale.min(height_scale).min(1.0);

    let minimum_width_scale = (TALL_MIN_WORKING_WIDTH as f32 / width as f32).min(1.0);
    if scale < minimum_width_scale {
        let candidate_height = (height as f32 * minimum_width_scale).round() as u32;
        let candidate_width = (width as f32 * minimum_width_scale).round() as u32;
        let candidate_pixels = candidate_width as u64 * candidate_height as u64;
        if candidate_height <= TALL_SOFT_MAX_HEIGHT && candidate_pixels <= TALL_SOFT_MAX_PIXELS {
            scale = minimum_width_scale;
        }
    }

    scaled_dimensions(width, height, scale)
}

fn scaled_dimensions(width: u32, height: u32, scale: f32) -> (u32, u32) {
    (
        ((width as f32 * scale).round() as u32).max(1),
        ((height as f32 * scale).round() as u32).max(1),
    )
}

fn adaptive_working_image(image: &DynamicImage) -> DynamicImage {
    let (width, height) = working_dimensions(image.width(), image.height());
    if width == image.width() && height == image.height() {
        return image.clone();
    }
    image.resize_exact(width, height, image::imageops::FilterType::Lanczos3)
}

fn structured_weekday_headers(
    tokens: &[Token],
    image_width: u32,
    image_height: u32,
) -> Vec<WeekdayHeader> {
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

    let footer_top = tokens
        .iter()
        .filter(|token| is_footer_table_header(&token.text))
        .map(|token| token.top)
        .min_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));

    let mut best_row = Vec::new();
    let mut best_score = f32::MIN;
    let mut best_y = f32::MAX;

    for seed in &candidates {
        let mut by_weekday: [Option<&Candidate>; 7] = std::array::from_fn(|_| None);
        for candidate in &candidates {
            let tolerance = seed.height.max(candidate.height) * 1.35 + 6.0;
            if (seed.center_y - candidate.center_y).abs() > tolerance {
                continue;
            }
            let slot = &mut by_weekday[(candidate.header.weekday - 1) as usize];
            if slot.is_none_or(|existing| {
                (candidate.center_y - seed.center_y).abs()
                    < (existing.center_y - seed.center_y).abs()
            }) {
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
        if row.len() < 2 {
            continue;
        }

        let monotonic = row
            .windows(2)
            .all(|pair| pair[0].weekday < pair[1].weekday);
        let span = row
            .last()
            .zip(row.first())
            .map(|(last, first)| (last.center_x - first.center_x).max(0.0))
            .unwrap_or_default();
        let span_ratio = (span / image_width.max(1) as f32).clamp(0.0, 1.0);
        let spacing_score = weekday_spacing_score(&row);
        let row_bottom = row
            .iter()
            .map(|header| header.bottom)
            .fold(0.0_f32, f32::max);
        let anchor_support =
            schedule_anchor_support_below(tokens, row_bottom, footer_top).min(8) as f32;
        let section_support =
            section_sequence_support_below(tokens, &row, image_width, row_bottom) as f32;
        let y_ratio = (seed.center_y / image_height.max(1) as f32).clamp(0.0, 1.0);
        let footer_penalty = footer_top
            .filter(|top| seed.center_y >= *top - 1.0)
            .map(|_| 60.0)
            .unwrap_or(0.0);

        let score = row.len() as f32 * 10.0
            + if monotonic { 12.0 } else { -24.0 }
            + span_ratio * 12.0
            + spacing_score * 10.0
            + anchor_support * 4.0
            + section_support * 3.0
            + (1.0 - y_ratio) * 3.0
            - footer_penalty;

        if score > best_score + 0.01
            || ((score - best_score).abs() <= 0.01 && seed.center_y < best_y)
        {
            best_score = score;
            best_y = seed.center_y;
            best_row = row;
        }
    }

    best_row
}

fn weekday_spacing_score(headers: &[WeekdayHeader]) -> f32 {
    if headers.len() < 3 {
        return 0.5;
    }
    let mut steps = headers
        .windows(2)
        .filter_map(|pair| {
            let weekday_delta = pair[1].weekday.saturating_sub(pair[0].weekday);
            (weekday_delta > 0)
                .then_some((pair[1].center_x - pair[0].center_x) / weekday_delta as f32)
        })
        .filter(|step| step.is_finite() && *step > 1.0)
        .collect::<Vec<_>>();
    if steps.len() < 2 {
        return 0.5;
    }
    steps.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let median = steps[steps.len() / 2].max(1.0);
    let mean_deviation = steps
        .iter()
        .map(|step| (step - median).abs() / median)
        .sum::<f32>()
        / steps.len() as f32;
    (1.0 - mean_deviation).clamp(0.0, 1.0)
}

fn schedule_anchor_support_below(
    tokens: &[Token],
    header_bottom: f32,
    footer_top: Option<f32>,
) -> usize {
    tokens
        .iter()
        .filter(|token| token.center_y() > header_bottom + 1.0)
        .filter(|token| footer_top.is_none_or(|top| token.center_y() < top))
        .filter(|token| {
            weekday_from_schedule_text(&token.text).is_some()
                && section_range_from_text(&token.text).is_some()
        })
        .count()
}

fn section_sequence_support_below(
    tokens: &[Token],
    headers: &[WeekdayHeader],
    image_width: u32,
    header_bottom: f32,
) -> usize {
    let cutoff = section_marker_cutoff(headers, image_width);
    let candidates = tokens
        .iter()
        .filter(|token| token.center_y() > header_bottom + 1.0 && token.center_x() < cutoff)
        .filter_map(|token| {
            section_marker_number_from_text(&token.text).map(|section| (section, token.center_y()))
        })
        .collect::<Vec<_>>();
    best_section_sequence(&candidates)
        .map(|sequence| sequence.len())
        .unwrap_or(0)
}

fn structured_section_markers(
    tokens: &[Token],
    headers: &[WeekdayHeader],
    image_width: u32,
) -> Vec<(u8, f32)> {
    if headers.is_empty() {
        return Vec::new();
    }
    let header_bottom = headers
        .iter()
        .map(|header| header.bottom)
        .fold(0.0_f32, f32::max);
    let cutoff = section_marker_cutoff(headers, image_width);
    let candidates = tokens
        .iter()
        .filter(|token| token.center_y() > header_bottom + 1.0 && token.center_x() < cutoff)
        .filter_map(|token| {
            section_marker_number_from_text(&token.text).map(|section| (section, token.center_y()))
        })
        .collect::<Vec<_>>();

    let Some(mut sequence) = best_section_sequence(&candidates) else {
        return Vec::new();
    };
    sequence.sort_by_key(|(section, _)| *section);
    if sequence.len() < 2 {
        return sequence;
    }

    let mut spacings = sequence
        .windows(2)
        .filter_map(|pair| {
            let section_delta = pair[1].0.saturating_sub(pair[0].0);
            (section_delta > 0).then_some((pair[1].1 - pair[0].1) / section_delta as f32)
        })
        .filter(|spacing| spacing.is_finite() && (8.0..=180.0).contains(spacing))
        .collect::<Vec<_>>();
    if spacings.is_empty() {
        return sequence;
    }
    spacings.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let spacing = spacings[spacings.len() / 2];
    let reference = sequence[0];
    let last_section = sequence
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

fn section_marker_cutoff(headers: &[WeekdayHeader], image_width: u32) -> f32 {
    headers
        .iter()
        .min_by(|left, right| {
            left.center_x
                .partial_cmp(&right.center_x)
                .unwrap_or(Ordering::Equal)
        })
        .map(|header| weekday_column_bounds(headers, header.weekday, image_width as f32).0)
        .filter(|cutoff| *cutoff > image_width as f32 * 0.025)
        .unwrap_or(image_width as f32 * 0.18)
        .min(image_width as f32 * 0.18)
}

fn best_section_sequence(candidates: &[(u8, f32)]) -> Option<Vec<(u8, f32)>> {
    if candidates.len() < 2 {
        return (!candidates.is_empty()).then(|| candidates.to_vec());
    }

    let mut best = Vec::new();
    let mut best_score = f32::MIN;
    for (left_index, left) in candidates.iter().enumerate() {
        for right in candidates.iter().skip(left_index + 1) {
            let section_delta = right.0 as i16 - left.0 as i16;
            let y_delta = right.1 - left.1;
            if section_delta <= 0 || y_delta <= 0.0 {
                continue;
            }
            let spacing = y_delta / section_delta as f32;
            if !(8.0..=180.0).contains(&spacing) {
                continue;
            }
            let tolerance = (spacing * 0.32).clamp(6.0, 22.0);
            let mut selected: Vec<(u8, f32, f32)> = Vec::new();
            for candidate in candidates {
                let predicted =
                    left.1 + (candidate.0 as i16 - left.0 as i16) as f32 * spacing;
                let error = (candidate.1 - predicted).abs();
                if error > tolerance {
                    continue;
                }
                if let Some(existing) = selected.iter_mut().find(|item| item.0 == candidate.0) {
                    if error < existing.2 {
                        *existing = (candidate.0, candidate.1, error);
                    }
                } else {
                    selected.push((candidate.0, candidate.1, error));
                }
            }
            selected.sort_by_key(|item| item.0);
            if selected.len() < 2 {
                continue;
            }
            let continuity = selected
                .windows(2)
                .filter(|pair| pair[1].0.saturating_sub(pair[0].0) <= 2)
                .count() as f32;
            let mean_error = selected.iter().map(|item| item.2 / spacing).sum::<f32>()
                / selected.len() as f32;
            let score = selected.len() as f32 * 10.0 + continuity * 2.0 - mean_error * 8.0;
            if score > best_score {
                best_score = score;
                best = selected
                    .into_iter()
                    .map(|(section, y, _)| (section, y))
                    .collect();
            }
        }
    }

    if best.len() >= 2 {
        Some(best)
    } else {
        None
    }
}

fn structured_timetable_content_bottom(
    tokens: &[Token],
    sections: &[(u8, f32)],
    headers: &[WeekdayHeader],
    image_height: u32,
    sections_inferred: bool,
) -> f32 {
    let header_bottom = headers
        .iter()
        .map(|header| header.bottom)
        .fold(0.0_f32, f32::max);
    let footer_top = tokens
        .iter()
        .filter(|token| token.top > header_bottom + 1.0)
        .filter(|token| is_footer_table_header(&token.text))
        .map(|token| token.top)
        .min_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));

    let geometric_bottom = section_geometry_bottom(sections, image_height);
    let secondary_header_top = secondary_weekday_row_top(tokens, header_bottom, geometric_bottom);

    let mut bottom = if sections_inferred {
        image_height as f32 * 0.98
    } else {
        geometric_bottom.unwrap_or(image_height as f32 * 0.98)
    };
    if let Some(geometry) = geometric_bottom {
        bottom = bottom.min(geometry);
    }
    if let Some(top) = footer_top {
        bottom = bottom.min((top - 1.0).max(header_bottom));
    }
    if let Some(top) = secondary_header_top {
        bottom = bottom.min((top - 1.0).max(header_bottom));
    }
    bottom.clamp(header_bottom, image_height as f32 * 0.995)
}

fn section_geometry_bottom(sections: &[(u8, f32)], image_height: u32) -> Option<f32> {
    if sections.len() < 2 {
        return None;
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
        return None;
    }
    spacings.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let row_height = spacings[spacings.len() / 2];
    let last_center = sections
        .iter()
        .filter(|(section, _)| *section <= DEFAULT_SECTION_COUNT)
        .max_by_key(|(section, _)| *section)
        .map(|(_, center)| *center)
        .or_else(|| sections.last().map(|(_, center)| *center))?;
    Some((last_center + row_height * 0.55).min(image_height as f32 * 0.995))
}

fn secondary_weekday_row_top(
    tokens: &[Token],
    main_header_bottom: f32,
    geometric_bottom: Option<f32>,
) -> Option<f32> {
    let search_start = geometric_bottom
        .map(|bottom| bottom - 24.0)
        .unwrap_or(main_header_bottom + 120.0)
        .max(main_header_bottom + 80.0);
    let mut candidates = tokens
        .iter()
        .filter_map(|token| {
            weekday_from_text(&token.text).map(|_| (token.center_y(), token.height))
        })
        .filter(|(center_y, _)| *center_y > search_start)
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.0.partial_cmp(&right.0).unwrap_or(Ordering::Equal));

    for seed in &candidates {
        let count = candidates
            .iter()
            .filter(|candidate| {
                (candidate.0 - seed.0).abs() <= seed.1.max(candidate.1) * 1.3 + 6.0
            })
            .count();
        if count >= 3 {
            return Some(seed.0 - seed.1 / 2.0);
        }
    }
    None
}

fn structured_course_anchors(tokens: &[Token]) -> Vec<CourseAnchor> {
    let mut anchors = tokens
        .iter()
        .enumerate()
        .filter_map(|(token_index, _)| {
            let metadata_text = structured_schedule_text_for_anchor(tokens, token_index);
            let weekday = weekday_from_schedule_text(&metadata_text)?;
            let (start_section, end_section) = section_range_from_text(&metadata_text)?;
            let (weeks, parity, used_default_weeks) = parse_weeks_segmented(&metadata_text);
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

    let detected_last_week = anchors
        .iter()
        .filter(|anchor| !anchor.used_default_weeks)
        .flat_map(|anchor| anchor.weeks.iter().copied())
        .max()
        .unwrap_or(DEFAULT_LAST_WEEK);
    for anchor in &mut anchors {
        if anchor.used_default_weeks {
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

fn structured_schedule_text_for_anchor(tokens: &[Token], token_index: usize) -> String {
    let anchor = &tokens[token_index];
    let has_truncated_week_tail = truncated_week_range_after_section(&anchor.text).is_some();
    if !parse_weeks_segmented(&anchor.text).2 && !has_truncated_week_tail {
        return anchor.text.clone();
    }

    let mut combined = anchor.text.clone();
    let maximum_gap = anchor.height.max(18.0) * 4.2 + 24.0;
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

    for (_, candidate) in continuations {
        if continuation_has_boundary(tokens, anchor, candidate) {
            break;
        }
        if !looks_like_schedule_continuation(&candidate.text) {
            continue;
        }
        combined.push_str(&candidate.text);
        if !parse_weeks_segmented(&combined).2 {
            break;
        }
    }
    combined
}

fn truncated_week_range_after_section(text: &str) -> Option<(u8, u8)> {
    let compact = compact_text(text);
    section_range_from_text(&compact)?;

    let section_end = compact.rfind('节')? + '节'.len_utf8();
    let tail = compact[section_end..].trim_matches(|character: char| {
        matches!(
            character,
            '(' | ')' | '（' | '）' | '{' | '}' | '[' | ']' | '【' | '】' | ',' | '，' | ';' | '；' | ':' | '：'
        )
    });
    if tail.is_empty() || tail.contains('周') {
        return None;
    }

    let pattern = Regex::new(r"^第?(\d{1,2})(?:[-—~－–‑]+|至|到)(\d{1,2})$").unwrap();
    let captures = pattern.captures(tail)?;
    let start = captures.get(1)?.as_str().parse::<u8>().ok()?;
    let end = captures.get(2)?.as_str().parse::<u8>().ok()?;
    (start > 0 && end >= start && end <= 30).then_some((start, end))
}

fn parse_weeks_segmented(text: &str) -> (Vec<u8>, String, bool) {
    #[derive(Clone, Copy)]
    enum SegmentParity {
        All,
        Odd,
        Even,
    }

    fn parity_from_capture(value: Option<&str>) -> SegmentParity {
        match value {
            Some("单") => SegmentParity::Odd,
            Some("双") => SegmentParity::Even,
            _ => SegmentParity::All,
        }
    }

    fn add_weeks(
        target: &mut std::collections::BTreeSet<u8>,
        values: impl IntoIterator<Item = u8>,
        parity: SegmentParity,
    ) {
        target.extend(values.into_iter().filter(|week| {
            (1..=30).contains(week)
                && match parity {
                    SegmentParity::All => true,
                    SegmentParity::Odd => week % 2 == 1,
                    SegmentParity::Even => week % 2 == 0,
                }
        }));
    }

    fn overlaps(span: (usize, usize), occupied: &[(usize, usize)]) -> bool {
        occupied
            .iter()
            .any(|existing| span.0 < existing.1 && existing.0 < span.1)
    }

    let compact = compact_text(text);
    let parity_suffix = r"(?:[（(]?([单双])周?[)）]?)?";
    let range = Regex::new(&format!(
        r"(?:第)?(\d{{1,2}})(?:[-—~－–‑]+|至|到)(\d{{1,2}})周{parity_suffix}"
    ))
    .unwrap();
    let list = Regex::new(&format!(
        r"(?:第)?(\d{{1,2}}(?:[,，、]\d{{1,2}})+)周{parity_suffix}"
    ))
    .unwrap();
    let single = Regex::new(&format!(r"(?:第)?(\d{{1,2}})周{parity_suffix}")).unwrap();

    let mut weeks = std::collections::BTreeSet::new();
    let mut occupied = Vec::new();
    let mut saw_odd = false;
    let mut saw_even = false;
    let mut saw_all = false;

    for captures in range.captures_iter(&compact) {
        let Some(matched) = captures.get(0) else {
            continue;
        };
        let Some(start) = captures
            .get(1)
            .and_then(|value| value.as_str().parse::<u8>().ok())
        else {
            continue;
        };
        let Some(end) = captures
            .get(2)
            .and_then(|value| value.as_str().parse::<u8>().ok())
        else {
            continue;
        };
        if start == 0 || end < start || end > 30 {
            continue;
        }
        let parity = parity_from_capture(captures.get(3).map(|value| value.as_str()));
        add_weeks(&mut weeks, start..=end, parity);
        match parity {
            SegmentParity::All => saw_all = true,
            SegmentParity::Odd => saw_odd = true,
            SegmentParity::Even => saw_even = true,
        }
        occupied.push((matched.start(), matched.end()));
    }

    for captures in list.captures_iter(&compact) {
        let Some(matched) = captures.get(0) else {
            continue;
        };
        let span = (matched.start(), matched.end());
        if overlaps(span, &occupied) {
            continue;
        }
        let parity = parity_from_capture(captures.get(2).map(|value| value.as_str()));
        let values = captures
            .get(1)
            .into_iter()
            .flat_map(|value| value.as_str().split([',', '，', '、']))
            .filter_map(|value| value.parse::<u8>().ok())
            .collect::<Vec<_>>();
        add_weeks(&mut weeks, values, parity);
        match parity {
            SegmentParity::All => saw_all = true,
            SegmentParity::Odd => saw_odd = true,
            SegmentParity::Even => saw_even = true,
        }
        occupied.push(span);
    }

    for captures in single.captures_iter(&compact) {
        let Some(matched) = captures.get(0) else {
            continue;
        };
        let span = (matched.start(), matched.end());
        if overlaps(span, &occupied) {
            continue;
        }
        let Some(week) = captures
            .get(1)
            .and_then(|value| value.as_str().parse::<u8>().ok())
        else {
            continue;
        };
        let parity = parity_from_capture(captures.get(2).map(|value| value.as_str()));
        add_weeks(&mut weeks, [week], parity);
        match parity {
            SegmentParity::All => saw_all = true,
            SegmentParity::Odd => saw_odd = true,
            SegmentParity::Even => saw_even = true,
        }
        occupied.push(span);
    }

    if weeks.is_empty() {
        if let Some((start, end)) = truncated_week_range_after_section(&compact) {
            add_weeks(&mut weeks, start..=end, SegmentParity::All);
            saw_all = true;
        }
    }

    let used_default = weeks.is_empty();
    if used_default {
        return ((1..=DEFAULT_LAST_WEEK).collect(), "all".into(), true);
    }
    let parity = if saw_odd && !saw_even && !saw_all {
        "odd"
    } else if saw_even && !saw_odd && !saw_all {
        "even"
    } else {
        "all"
    };
    (weeks.into_iter().collect(), parity.into(), false)
}

fn normalized_ascii_spacing(value: &str) -> Option<(String, String)> {
    if !value.chars().any(char::is_whitespace) {
        return None;
    }
    let display = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let ascii_word_count = display
        .split(' ')
        .filter(|part| {
            part.chars()
                .any(|character| character.is_ascii_alphabetic())
        })
        .count();
    (ascii_word_count >= 1).then(|| (compact_text(&display), display))
}

#[cfg(test)]
mod structural_generalization_tests {
    use super::*;

    fn token(text: &str, left: f32, top: f32, width: f32, height: f32) -> Token {
        Token::from_text(text, 0.95, left, top, width, height).unwrap()
    }

    #[test]
    fn tall_screenshots_keep_a_usable_working_width() {
        let first = working_dimensions(1080, 4000);
        let second = working_dimensions(1440, 6000);
        assert!(first.0 >= 800, "1080x4000 became {first:?}");
        assert!(second.0 >= 800, "1440x6000 became {second:?}");
        assert!(first.0 as u64 * first.1 as u64 <= TALL_SOFT_MAX_WORKING_PIXELS);
        assert!(second.0 as u64 * second.1 as u64 <= TALL_SOFT_MAX_WORKING_PIXELS);
        assert_eq!(detector_max_side_for_dimensions(1080, 4000), 1280);
        assert_eq!(detector_max_side_for_dimensions(1440, 6000), 1280);
        assert_eq!(detector_max_side_for_dimensions(1600, 1000), 960);
    }

    #[test]
    fn field_keywords_do_not_veto_legitimate_course_names() {
        for name in [
            "室内设计",
            "数据中心技术",
            "楼宇自动化",
            "体育馆建筑设计",
            "教师职业道德",
            "教师教育学",
        ] {
            assert_eq!(course_name_from_text(name).as_deref(), Some(name));
        }
    }

    #[test]
    fn strong_teacher_and_location_grammar_remain_available() {
        assert!(is_teacher_text("教师：张三"));
        assert!(is_teacher_text("李四老师"));
        assert!(is_location_text("教3-201"));
        assert!(is_location_text("逸夫楼205"));
        assert!(is_location_text("体育馆2"));
        assert!(!is_location_text("数据中心技术"));
    }

    #[test]
    fn week_parity_is_applied_per_segment() {
        assert_eq!(
            parse_weeks_segmented("第1周，第2-16周双周").0,
            vec![1, 2, 4, 6, 8, 10, 12, 14, 16]
        );
        assert_eq!(
            parse_weeks_segmented("1-8周单周，10-16周双周").0,
            vec![1, 3, 5, 7, 10, 12, 14, 16]
        );
        assert_eq!(parse_weeks_segmented("1,3,5,7周").0, vec![1, 3, 5, 7]);
    }

    #[test]
    fn truncated_week_range_is_recovered_only_after_sections() {
        let (weeks, parity, used_default) = parse_weeks_segmented("周四第8.9节(第3-17");
        assert_eq!(weeks, (3..=17).collect::<Vec<_>>());
        assert_eq!(parity, "all");
        assert!(!used_default);

        let (weeks, parity, used_default) = parse_weeks_segmented("周四第8,9节第3-17周");
        assert_eq!(weeks, (3..=17).collect::<Vec<_>>());
        assert_eq!(parity, "all");
        assert!(!used_default);

        let (weeks, parity, used_default) = parse_weeks_segmented("周四第8-9节");
        assert_eq!(weeks, (1..=DEFAULT_LAST_WEEK).collect::<Vec<_>>());
        assert_eq!(parity, "all");
        assert!(used_default);

        let (weeks, parity, used_default) = parse_weeks_segmented("周一第6,7节第5-5");
        assert_eq!(weeks, vec![5]);
        assert_eq!(parity, "all");
        assert!(!used_default);

        let (weeks, parity, used_default) = parse_weeks_segmented("周二第8,9节第1-17周单周");
        assert_eq!(weeks, vec![1, 3, 5, 7, 9, 11, 13, 15, 17]);
        assert_eq!(parity, "odd");
        assert!(!used_default);
    }

    #[test]
    fn truncated_week_tail_still_accepts_a_parity_continuation() {
        let tokens = vec![
            token("周四第8,9节{第1-1", 660.0, 128.0, 190.0, 22.0),
            token("周单周)", 660.0, 154.0, 90.0, 22.0),
        ];
        let metadata = structured_schedule_text_for_anchor(&tokens, 0);
        assert_eq!(metadata, "周四第8,9节{第1-1周单周)");
        let (weeks, parity, used_default) = parse_weeks_segmented(&metadata);
        assert_eq!(weeks, vec![1]);
        assert_eq!(parity, "odd");
        assert!(!used_default);
    }

    #[test]
    fn real_b_truncated_week_tail_keeps_two_disjoint_arrangements() {
        let tokens = vec![
            token("课程A", 660.0, 100.0, 120.0, 22.0),
            token("周四第8,9节{第1-1", 660.0, 128.0, 190.0, 22.0),
            token("周单周)", 660.0, 154.0, 90.0, 22.0),
            token("教师甲", 660.0, 180.0, 70.0, 22.0),
            token("教3-301", 660.0, 206.0, 90.0, 22.0),
            token("(调0042)", 660.0, 232.0, 82.0, 20.0),
            token("课程A", 660.0, 270.0, 120.0, 22.0),
            token("周四第8.9节(第3-17", 660.0, 298.0, 190.0, 22.0),
            token("教师甲", 660.0, 326.0, 70.0, 22.0),
            token("教3-301", 660.0, 352.0, 90.0, 22.0),
            token("(调0042)", 660.0, 378.0, 82.0, 20.0),
        ];

        let anchors = structured_course_anchors(&tokens);
        let target = anchors
            .iter()
            .filter(|anchor| {
                anchor.weekday == 4 && anchor.start_section == 8 && anchor.end_section == 9
            })
            .collect::<Vec<_>>();
        assert_eq!(target.len(), 2);
        assert_eq!(target[0].weeks, vec![1]);
        assert_eq!(target[0].parity, "odd");
        assert_eq!(target[1].metadata_text, "周四第8.9节(第3-17");
        assert_eq!(target[1].weeks, (3..=17).collect::<Vec<_>>());
        assert_eq!(target[1].parity, "all");
        assert!(!target[1].used_default_weeks);

        let headers = (1..=6)
            .map(|weekday| WeekdayHeader {
                weekday,
                center_x: 180.0 + (weekday as f32 - 1.0) * 180.0,
                bottom: 80.0,
            })
            .collect::<Vec<_>>();
        let parsed = anchor_courses(&tokens, &anchors, &headers, 1260, 760).0;
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].weeks, vec![1]);
        assert_eq!(parsed[0].parity, "odd");
        assert_eq!(parsed[1].weeks, (3..=17).collect::<Vec<_>>());
        assert_eq!(parsed[1].parity, "all");
    }

    #[test]
    fn numbers_above_weekday_header_do_not_form_section_sequence() {
        let headers = vec![
            WeekdayHeader {
                weekday: 1,
                center_x: 220.0,
                bottom: 220.0,
            },
            WeekdayHeader {
                weekday: 2,
                center_x: 360.0,
                bottom: 220.0,
            },
            WeekdayHeader {
                weekday: 3,
                center_x: 500.0,
                bottom: 220.0,
            },
        ];
        let mut tokens = vec![
            token("1", 20.0, 30.0, 20.0, 20.0),
            token("2", 20.0, 60.0, 20.0, 20.0),
            token("7", 20.0, 90.0, 20.0, 20.0),
            token("18", 20.0, 120.0, 28.0, 20.0),
        ];
        for section in 1..=12 {
            tokens.push(token(
                &section.to_string(),
                24.0,
                250.0 + (section - 1) as f32 * 46.0,
                24.0,
                20.0,
            ));
        }
        let markers = structured_section_markers(&tokens, &headers, 900);
        assert_eq!(markers.first().map(|value| value.0), Some(1));
        assert!(markers.first().unwrap().1 > 220.0);
        assert_eq!(
            markers
                .iter()
                .find(|value| value.0 == 12)
                .map(|value| value.0),
            Some(12)
        );
    }

    #[test]
    fn fuller_footer_weekday_row_does_not_beat_supported_main_header() {
        let mut tokens = Vec::new();
        for (label, x) in [
            ("星期一", 180.0),
            ("星期二", 310.0),
            ("星期三", 440.0),
            ("星期五", 700.0),
        ] {
            tokens.push(token(label, x, 100.0, 70.0, 24.0));
        }
        for (label, x) in [
            ("星期一", 160.0),
            ("星期二", 270.0),
            ("星期三", 380.0),
            ("星期四", 490.0),
            ("星期五", 600.0),
            ("星期六", 710.0),
            ("星期日", 820.0),
        ] {
            tokens.push(token(label, x, 720.0, 70.0, 24.0));
        }
        tokens.push(token("实践课信息", 100.0, 680.0, 160.0, 24.0));
        for (index, schedule) in [
            "周一第1-2节第1-16周",
            "周二第3-4节第1-16周",
            "周三第5-6节第1-16周",
            "周五第7-8节第1-16周",
        ]
        .iter()
        .enumerate()
        {
            tokens.push(token(
                schedule,
                180.0 + index as f32 * 130.0,
                250.0 + index as f32 * 40.0,
                150.0,
                24.0,
            ));
        }
        let headers = structured_weekday_headers(&tokens, 1000, 900);
        assert!(headers.iter().all(|header| header.bottom < 200.0));
        assert_eq!(headers.len(), 4);
    }

    #[test]
    fn inferred_sections_still_honor_footer_boundary() {
        let headers = vec![
            WeekdayHeader {
                weekday: 1,
                center_x: 220.0,
                bottom: 120.0,
            },
            WeekdayHeader {
                weekday: 2,
                center_x: 360.0,
                bottom: 120.0,
            },
            WeekdayHeader {
                weekday: 3,
                center_x: 500.0,
                bottom: 120.0,
            },
        ];
        let sections = (1..=12)
            .map(|section| (section, 180.0 + (section - 1) as f32 * 45.0))
            .collect::<Vec<_>>();
        let tokens = vec![
            token("实践课信息", 80.0, 760.0, 180.0, 24.0),
            token("学分", 80.0, 800.0, 80.0, 24.0),
            token("起止周", 180.0, 800.0, 80.0, 24.0),
            token("星期一", 300.0, 830.0, 80.0, 24.0),
            token("星期二", 430.0, 830.0, 80.0, 24.0),
            token("星期三", 560.0, 830.0, 80.0, 24.0),
        ];
        let bottom =
            structured_timetable_content_bottom(&tokens, &sections, &headers, 1200, true);
        assert!(bottom < 760.0);
    }

    #[test]
    fn ascii_and_mixed_course_spacing_can_be_restored_after_compact_parsing() {
        assert_eq!(
            normalized_ascii_spacing("College English III"),
            Some(("CollegeEnglishIII".into(), "College English III".into()))
        );
        assert_eq!(
            normalized_ascii_spacing("Python Programming"),
            Some(("PythonProgramming".into(), "Python Programming".into()))
        );
        assert_eq!(
            normalized_ascii_spacing("Signals and Systems"),
            Some(("SignalsandSystems".into(), "Signals and Systems".into()))
        );
        assert_eq!(
            normalized_ascii_spacing("人工智能 Python 应用"),
            Some(("人工智能Python应用".into(), "人工智能 Python 应用".into()))
        );
        assert_eq!(course_name_from_text("C++程序设计").as_deref(), Some("C++程序设计"));
    }
}
