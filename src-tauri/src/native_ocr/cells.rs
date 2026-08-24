#[derive(Debug, Clone)]
struct CourseCardSeed {
    anchor_token_index: usize,
    weekday: u8,
    title_token_index: Option<usize>,
    auxiliary: bool,
}

#[derive(Debug, Clone, Copy)]
struct CourseCardGeometry {
    weekday: u8,
    column_bounds: (f32, f32),
    upper_bound: f32,
    lower_bound: f32,
}

fn course_card_seeds(
    tokens: &[Token],
    anchors: &[CourseAnchor],
    headers: &[WeekdayHeader],
    image_width: f32,
) -> Vec<CourseCardSeed> {
    let column_step = estimated_weekday_step(headers, image_width);
    anchors
        .iter()
        .map(|anchor| {
            let anchor_token = &tokens[anchor.token_index];
            // Some OCR engines return a whole course card as one multiline token. In
            // that case the schedule anchor already shares the card's true geometry;
            // looking upward for a title can accidentally attach the previous card.
            let title_token_index = if token_contains_embedded_course_title(anchor_token) {
                Some(anchor.token_index)
            } else {
                nearest_card_title_token(
                    tokens,
                    anchor_token,
                    headers,
                    image_width,
                    column_step,
                )
            };
            let weekday = course_card_weekday(
                tokens,
                anchor_token,
                title_token_index,
                anchor.weekday,
                headers,
                image_width,
            );
            let auxiliary = anchor_has_auxiliary_annotation(tokens, anchor_token, column_step);
            CourseCardSeed {
                anchor_token_index: anchor.token_index,
                weekday,
                title_token_index,
                auxiliary,
            }
        })
        .collect()
}

fn course_card_geometry(
    tokens: &[Token],
    anchors: &[CourseAnchor],
    seeds: &[CourseCardSeed],
    anchor_index: usize,
    headers: &[WeekdayHeader],
    image_width: f32,
) -> CourseCardGeometry {
    let seed = &seeds[anchor_index];
    let anchor_token = &tokens[seed.anchor_token_index];
    let column_bounds = weekday_column_bounds(headers, seed.weekday, image_width);

    let previous_index = seeds
        .iter()
        .enumerate()
        .filter(|(index, candidate)| {
            *index != anchor_index
                && candidate.weekday == seed.weekday
                && tokens[candidate.anchor_token_index].center_y() < anchor_token.center_y()
        })
        .max_by(|left, right| {
            tokens[left.1.anchor_token_index]
                .center_y()
                .partial_cmp(&tokens[right.1.anchor_token_index].center_y())
                .unwrap_or(Ordering::Equal)
        })
        .map(|(index, _)| index);
    let next_index = seeds
        .iter()
        .enumerate()
        .filter(|(index, candidate)| {
            *index != anchor_index
                && candidate.weekday == seed.weekday
                && tokens[candidate.anchor_token_index].center_y() > anchor_token.center_y()
        })
        .min_by(|left, right| {
            tokens[left.1.anchor_token_index]
                .center_y()
                .partial_cmp(&tokens[right.1.anchor_token_index].center_y())
                .unwrap_or(Ordering::Equal)
        })
        .map(|(index, _)| index);

    let header_bottom = headers
        .iter()
        .find(|header| header.weekday == seed.weekday)
        .map(|header| header.bottom)
        .unwrap_or(0.0);
    let previous_anchor_y = previous_index
        .map(|index| tokens[seeds[index].anchor_token_index].center_y())
        .unwrap_or(header_bottom);

    let upper_bound = if seed.title_token_index == Some(seed.anchor_token_index) {
        // Whole-card multiline OCR token: its own top is the card top.
        anchor_token.top
    } else {
        // Expand from the nearest title line to the beginning of a wrapped title. The
        // selected line remains a fallback when the title reconstruction is ambiguous.
        title_start_before_anchor(tokens, column_bounds, previous_anchor_y, anchor_token)
            .or_else(|| seed.title_token_index.map(|index| tokens[index].top))
            .unwrap_or_else(|| {
                previous_index
                    .map(|index| {
                        (tokens[seeds[index].anchor_token_index].center_y()
                            + anchor_token.center_y())
                            / 2.0
                    })
                    .unwrap_or_else(|| {
                        (anchor_token.center_y() - anchor_token.height.max(24.0) * 4.5)
                            .max(header_bottom)
                    })
            })
    };

    let mut lower_bound = next_index
        .and_then(|index| {
            let next_seed = &seeds[index];
            if next_seed.title_token_index == Some(next_seed.anchor_token_index) {
                Some(tokens[next_seed.anchor_token_index].top)
            } else {
                title_start_before_anchor(
                    tokens,
                    column_bounds,
                    anchor_token.center_y(),
                    &tokens[next_seed.anchor_token_index],
                )
                .or_else(|| next_seed.title_token_index.map(|title_index| tokens[title_index].top))
            }
            .filter(|top| *top > anchor_token.center_y() + 0.5)
        })
        .or_else(|| {
            next_index.map(|index| {
                (anchor_token.center_y() + tokens[seeds[index].anchor_token_index].center_y()) / 2.0
            })
        })
        .unwrap_or(anchor_token.center_y() + anchor_token.height.max(24.0) * 4.5);

    if lower_bound <= upper_bound + 1.0 {
        lower_bound = anchor_token.center_y() + anchor_token.height.max(24.0) * 4.5;
    }

    // Keep the signature tied to the anchor list: card geometry is defined per parsed
    // arrangement even when the current calculation only needs the seed/token geometry.
    let _ = &anchors[anchor_index];
    CourseCardGeometry {
        weekday: seed.weekday,
        column_bounds,
        upper_bound,
        lower_bound,
    }
}

fn token_contains_embedded_course_title(token: &Token) -> bool {
    if token.parts.len() < 2 {
        return false;
    }
    let Some(schedule_index) = token.parts.iter().position(|value| {
        weekday_from_schedule_text(value).is_some() && section_range_from_text(value).is_some()
    }) else {
        return false;
    };
    token.parts[..schedule_index]
        .iter()
        .any(|value| course_name_from_text(value).is_some())
}

fn nearest_card_title_token(
    tokens: &[Token],
    anchor: &Token,
    headers: &[WeekdayHeader],
    image_width: f32,
    column_step: f32,
) -> Option<usize> {
    let maximum_gap = anchor.height.max(18.0) * 5.2 + 28.0;
    let mut candidates = tokens
        .iter()
        .enumerate()
        .filter(|(_, token)| token.center_y() < anchor.center_y() - 0.5)
        .filter(|(_, token)| {
            let gap = anchor.top - token.bottom();
            gap >= -token.height.max(anchor.height) * 0.8 && gap <= maximum_gap
        })
        .filter(|(_, token)| !token_has_auxiliary_annotation(token))
        .filter_map(|(index, token)| {
            let name = name_fragment_from_token(token)?;
            (!is_bare_teacher_name(&name)).then_some((index, token, name))
        })
        .filter(|(_, token, _)| {
            horizontal_interval_gap(anchor, token) <= column_step * 0.38
                || (anchor.center_x() - token.center_x()).abs() <= column_step * 0.95
        })
        .map(|(index, token, name)| {
            let score = card_title_support_score(
                tokens,
                anchor,
                token,
                &name,
                headers,
                image_width,
                column_step,
            );
            (index, token, name, score)
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        right
            .3
            .partial_cmp(&left.3)
            .unwrap_or(Ordering::Equal)
            .then_with(|| has_course_code(&right.2).cmp(&has_course_code(&left.2)))
            .then_with(|| {
                let left_vertical = (anchor.top - left.1.bottom()).abs();
                let right_vertical = (anchor.top - right.1.bottom()).abs();
                left_vertical
                    .partial_cmp(&right_vertical)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| {
                horizontal_interval_gap(anchor, left.1)
                    .partial_cmp(&horizontal_interval_gap(anchor, right.1))
                    .unwrap_or(Ordering::Equal)
            })
    });
    candidates.first().map(|(index, _, _, _)| *index)
}

fn card_title_support_score(
    tokens: &[Token],
    anchor: &Token,
    title: &Token,
    title_name: &str,
    headers: &[WeekdayHeader],
    image_width: f32,
    column_step: f32,
) -> f32 {
    let Some(weekday) = weekday_for_token(headers, title, image_width) else {
        return 0.0;
    };
    let bounds = weekday_column_bounds(headers, weekday, image_width);
    let upper = title.top - title.height.max(18.0) * 0.4;
    let lower = anchor.bottom() + anchor.height.max(18.0) * 2.6 + 16.0;
    let mut score = 3.0_f32;
    if has_course_code(title_name) {
        score += 2.5;
    }
    if title_name.chars().count() >= 6 {
        score += 0.8;
    }

    let mut teacher_support = 0_u8;
    let mut location_support = 0_u8;
    let mut competing_schedule = 0_u8;
    for token in tokens {
        if std::ptr::eq(token, anchor)
            || std::ptr::eq(token, title)
            || token.center_y() < upper
            || token.center_y() > lower
            || token.center_x() < bounds.0
            || token.center_x() >= bounds.1
            || token_has_auxiliary_annotation(token)
        {
            continue;
        }

        let has_schedule = token
            .parts
            .iter()
            .chain(std::iter::once(&token.text))
            .any(|value| {
                weekday_from_schedule_text(value).is_some()
                    && section_range_from_text(value).is_some()
            });
        if has_schedule {
            // A title that already has another schedule anchor in its own column is
            // very likely a neighbouring card. This is the key distinction when the
            // current anchor's OCR box and weekday text are both shifted into that
            // neighbouring column.
            competing_schedule = competing_schedule.saturating_add(1);
            continue;
        }

        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if location_from_text(value).is_some() || compact_location_from_text(value).is_some() {
                location_support = location_support.saturating_add(1);
                break;
            }
            if is_teacher_text(value) || is_bare_teacher_name(value) {
                teacher_support = teacher_support.saturating_add(1);
                break;
            }
        }
    }

    score += location_support.min(2) as f32 * 3.2;
    score += teacher_support.min(2) as f32 * 2.0;
    score -= competing_schedule.min(2) as f32 * 5.5;

    let vertical_gap = (anchor.top - title.bottom()).max(0.0);
    score -= (vertical_gap / anchor.height.max(title.height).max(18.0)).min(5.0) * 0.22;
    score -= (horizontal_interval_gap(anchor, title) / column_step.max(1.0)).min(1.0) * 0.5;
    score
}

fn course_card_weekday(
    tokens: &[Token],
    anchor: &Token,
    title_token_index: Option<usize>,
    parsed_weekday: u8,
    headers: &[WeekdayHeader],
    image_width: f32,
) -> u8 {
    if headers.is_empty() {
        return parsed_weekday;
    }

    // Once a coherent card title has been selected, its grid column is stronger than
    // both the OCR weekday text and a shifted schedule bbox. The previous broad vote
    // over all nearby text allowed unrelated cards in adjacent columns to outvote the
    // real card and is deliberately not used here.
    if let Some(index) = title_token_index {
        if let Some(weekday) = weekday_for_token(headers, &tokens[index], image_width) {
            return weekday;
        }
    }

    if token_contains_embedded_course_title(anchor) {
        if let Some(weekday) = weekday_for_token(headers, anchor, image_width) {
            return weekday;
        }
    }
    parsed_weekday
}

fn anchor_has_auxiliary_annotation(tokens: &[Token], anchor: &Token, column_step: f32) -> bool {
    if token_has_auxiliary_annotation(anchor) {
        return true;
    }
    let maximum_gap = anchor.height.max(18.0) * 5.0 + 28.0;
    tokens.iter().any(|token| {
        if std::ptr::eq(token, anchor) || !token_has_auxiliary_annotation(token) {
            return false;
        }
        let vertical_gap = anchor.top - token.bottom();
        if vertical_gap < -token.height.max(anchor.height) * 0.6 || vertical_gap > maximum_gap {
            return false;
        }
        if horizontal_interval_gap(anchor, token) > column_step * 0.36
            && (anchor.center_x() - token.center_x()).abs() > column_step * 0.72
        {
            return false;
        }

        // Do not let a much earlier adjustment marker suppress a later normal course.
        // A distinct schedule anchor between the marker and this anchor is a hard card
        // boundary.
        !tokens.iter().any(|between| {
            !std::ptr::eq(between, anchor)
                && !std::ptr::eq(between, token)
                && between.center_y() > token.center_y() + 0.5
                && between.center_y() < anchor.center_y() - 0.5
                && horizontally_related(anchor, between)
                && weekday_from_schedule_text(&between.text).is_some()
                && section_range_from_text(&between.text).is_some()
        })
    })
}

fn token_has_auxiliary_annotation(token: &Token) -> bool {
    token
        .parts
        .iter()
        .chain(std::iter::once(&token.text))
        .any(|value| is_auxiliary_course_annotation(value))
}

fn horizontal_interval_gap(left: &Token, right: &Token) -> f32 {
    if left.right() < right.left {
        right.left - left.right()
    } else if right.right() < left.left {
        left.left - right.right()
    } else {
        0.0
    }
}

fn weekday_for_token(
    headers: &[WeekdayHeader],
    token: &Token,
    image_width: f32,
) -> Option<u8> {
    headers
        .iter()
        .map(|header| {
            let bounds = weekday_column_bounds(headers, header.weekday, image_width);
            let overlap = (token.right().min(bounds.1) - token.left.max(bounds.0)).max(0.0);
            let center_distance = (header.center_x - token.center_x()).abs();
            (header.weekday, overlap, center_distance)
        })
        .max_by(|left, right| {
            left.1
                .partial_cmp(&right.1)
                .unwrap_or(Ordering::Equal)
                .then_with(|| {
                    right
                        .2
                        .partial_cmp(&left.2)
                        .unwrap_or(Ordering::Equal)
                })
        })
        .map(|(weekday, _, _)| weekday)
}

fn weekday_at_x(headers: &[WeekdayHeader], x: f32, image_width: f32) -> Option<u8> {
    headers
        .iter()
        .find(|header| {
            let bounds = weekday_column_bounds(headers, header.weekday, image_width);
            x >= bounds.0 && x < bounds.1
        })
        .map(|header| header.weekday)
        .or_else(|| {
            headers
                .iter()
                .min_by(|left, right| {
                    (left.center_x - x)
                        .abs()
                        .partial_cmp(&(right.center_x - x).abs())
                        .unwrap_or(Ordering::Equal)
                })
                .map(|header| header.weekday)
        })
}

fn estimated_weekday_step(headers: &[WeekdayHeader], image_width: f32) -> f32 {
    let mut steps = headers
        .windows(2)
        .filter_map(|pair| {
            let weekday_delta = pair[1].weekday.saturating_sub(pair[0].weekday);
            (weekday_delta > 0)
                .then_some((pair[1].center_x - pair[0].center_x).abs() / weekday_delta as f32)
        })
        .filter(|step| step.is_finite() && *step > 1.0)
        .collect::<Vec<_>>();
    if steps.is_empty() {
        return (image_width / headers.len().max(1) as f32).max(1.0);
    }
    steps.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    steps[steps.len() / 2]
}

fn is_auxiliary_course_annotation(value: &str) -> bool {
    let compact = compact_text(value);
    let mut rest = compact.as_str();
    if let Some(stripped) = rest.strip_prefix('（').or_else(|| rest.strip_prefix('(')) {
        rest = stripped;
    }
    let Some(stripped) = rest.strip_prefix('调').or_else(|| rest.strip_prefix('停')) else {
        return false;
    };
    stripped
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count()
        >= 3
}
