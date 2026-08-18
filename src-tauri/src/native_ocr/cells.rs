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
                nearest_card_title_token(tokens, anchor_token, column_step)
            };
            let weekday = course_card_weekday(
                tokens,
                anchor_token,
                title_token_index,
                anchor.weekday,
                headers,
                image_width,
                column_step,
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
    column_step: f32,
) -> Option<usize> {
    let maximum_gap = anchor.height.max(18.0) * 4.8 + 24.0;
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
            horizontal_interval_gap(anchor, token) <= column_step * 0.32
                || (anchor.center_x() - token.center_x()).abs() <= column_step * 0.82
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        let left_gap = horizontal_interval_gap(anchor, left.1);
        let right_gap = horizontal_interval_gap(anchor, right.1);
        left_gap
            .partial_cmp(&right_gap)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                let left_vertical = (anchor.top - left.1.bottom()).abs();
                let right_vertical = (anchor.top - right.1.bottom()).abs();
                left_vertical
                    .partial_cmp(&right_vertical)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| has_course_code(&right.2).cmp(&has_course_code(&left.2)))
            .then_with(|| {
                (anchor.center_x() - left.1.center_x())
                    .abs()
                    .partial_cmp(&(anchor.center_x() - right.1.center_x()).abs())
                    .unwrap_or(Ordering::Equal)
            })
    });
    candidates.first().map(|(index, _, _)| *index)
}

fn course_card_weekday(
    tokens: &[Token],
    anchor: &Token,
    title_token_index: Option<usize>,
    parsed_weekday: u8,
    headers: &[WeekdayHeader],
    image_width: f32,
    column_step: f32,
) -> u8 {
    if headers.is_empty() {
        return parsed_weekday;
    }

    let mut scores = [0.0_f32; 8];
    let mut evidence = [0_u8; 8];
    let vertical_radius = anchor.height.max(18.0) * 6.0 + 28.0;
    let top = anchor.center_y() - vertical_radius;
    let bottom = anchor.center_y() + vertical_radius;

    for (index, token) in tokens.iter().enumerate() {
        if std::ptr::eq(token, anchor)
            || token.center_y() < top
            || token.center_y() > bottom
            || is_weekday_header(&token.text)
            || section_number_from_text(&token.text).is_some()
            || token_has_auxiliary_annotation(token)
        {
            continue;
        }

        let interval_gap = horizontal_interval_gap(anchor, token);
        let center_distance = (anchor.center_x() - token.center_x()).abs();
        if interval_gap > column_step * 0.34 && center_distance > column_step * 0.86 {
            continue;
        }

        let mut weight = 0.0_f32;
        for value in token.parts.iter().chain(std::iter::once(&token.text)) {
            if location_from_text(value).is_some() || compact_location_from_text(value).is_some() {
                weight = weight.max(4.0);
            } else if course_name_from_text(value).is_some() {
                weight = weight.max(3.0);
            } else if is_bare_teacher_name(value) {
                weight = weight.max(2.0);
            }
        }
        if weight <= 0.0 {
            continue;
        }

        if Some(index) == title_token_index {
            weight += 0.5;
        }
        let Some(weekday) = weekday_at_x(headers, token.center_x(), image_width) else {
            continue;
        };
        let proximity = (1.0 - center_distance / (column_step * 1.6).max(1.0)).clamp(0.45, 1.0);
        scores[weekday as usize] += weight * proximity;
        evidence[weekday as usize] = evidence[weekday as usize].saturating_add(1);
    }

    // The anchor bbox itself is weak geometric evidence only. OCR commonly makes a
    // schedule box too wide or shifts it into the neighbouring weekday column.
    if let Some(anchor_geometry_weekday) = weekday_at_x(headers, anchor.center_x(), image_width) {
        scores[anchor_geometry_weekday as usize] += 0.75;
    }

    let best = (1_u8..=7)
        .filter(|weekday| headers.iter().any(|header| header.weekday == *weekday))
        .max_by(|left, right| {
            scores[*left as usize]
                .partial_cmp(&scores[*right as usize])
                .unwrap_or(Ordering::Equal)
                .then_with(|| evidence[*left as usize].cmp(&evidence[*right as usize]))
        });

    let Some(best) = best else {
        return parsed_weekday;
    };
    let best_score = scores[best as usize];
    let parsed_score = scores[parsed_weekday as usize];
    if evidence[best as usize] >= 2 && best_score >= parsed_score + 0.8 {
        return best;
    }
    if best_score > 0.0 && evidence[best as usize] > evidence[parsed_weekday as usize] {
        return best;
    }

    title_token_index
        .and_then(|index| weekday_at_x(headers, tokens[index].center_x(), image_width))
        .unwrap_or(parsed_weekday)
}

fn anchor_has_auxiliary_annotation(tokens: &[Token], anchor: &Token, column_step: f32) -> bool {
    if token_has_auxiliary_annotation(anchor) {
        return true;
    }
    let maximum_gap = anchor.height.max(18.0) * 2.8 + 16.0;
    tokens.iter().any(|token| {
        if std::ptr::eq(token, anchor) || !token_has_auxiliary_annotation(token) {
            return false;
        }
        let vertical_gap = anchor.top - token.bottom();
        vertical_gap >= -token.height.max(anchor.height) * 0.5
            && vertical_gap <= maximum_gap
            && (horizontal_interval_gap(anchor, token) <= column_step * 0.28
                || (anchor.center_x() - token.center_x()).abs() <= column_step * 0.55)
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
