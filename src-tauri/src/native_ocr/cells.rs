#[derive(Debug, Clone)]
struct CourseCardSeed {
    anchor_token_index: usize,
    weekday: u8,
    title_token_index: Option<usize>,
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
            let title_token_index =
                nearest_card_title_token(tokens, anchor_token, column_step);
            let geometry_x = title_token_index
                .map(|index| tokens[index].center_x())
                .unwrap_or_else(|| anchor_token.center_x());
            let weekday = weekday_at_x(headers, geometry_x, image_width)
                .unwrap_or(anchor.weekday);
            CourseCardSeed {
                anchor_token_index: anchor.token_index,
                weekday,
                title_token_index,
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
    let anchor = &anchors[anchor_index];
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

    let upper_bound = seed
        .title_token_index
        .map(|index| tokens[index].top)
        .or_else(|| {
            title_start_before_anchor(
                tokens,
                column_bounds,
                previous_anchor_y,
                anchor_token,
            )
        })
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
        });

    let mut lower_bound = next_index
        .and_then(|index| {
            seeds[index]
                .title_token_index
                .map(|title_index| tokens[title_index].top)
                .filter(|top| *top > anchor_token.center_y() + 0.5)
        })
        .or_else(|| {
            next_index.and_then(|index| {
                title_start_before_anchor(
                    tokens,
                    column_bounds,
                    anchor_token.center_y(),
                    &tokens[seeds[index].anchor_token_index],
                )
            })
        })
        .or_else(|| {
            next_index.map(|index| {
                (anchor_token.center_y()
                    + tokens[seeds[index].anchor_token_index].center_y())
                    / 2.0
            })
        })
        .unwrap_or(anchor_token.center_y() + anchor_token.height.max(24.0) * 4.5);

    if lower_bound <= upper_bound + 1.0 {
        lower_bound = anchor_token.center_y() + anchor_token.height.max(24.0) * 4.5;
    }

    let _ = anchor;
    CourseCardGeometry {
        weekday: seed.weekday,
        column_bounds,
        upper_bound,
        lower_bound,
    }
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
        .filter(|(_, token)| !is_auxiliary_course_annotation(&token.text))
        .filter_map(|(index, token)| {
            let name = name_fragment_from_token(token)?;
            (!is_bare_teacher_name(&name)).then_some((index, token, name))
        })
        .filter(|(_, token, _)| {
            horizontally_related(anchor, token)
                || (anchor.center_x() - token.center_x()).abs() <= column_step * 0.78
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        let left_gap = (anchor.top - left.1.bottom()).abs();
        let right_gap = (anchor.top - right.1.bottom()).abs();
        left_gap
            .partial_cmp(&right_gap)
            .unwrap_or(Ordering::Equal)
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

fn weekday_at_x(
    headers: &[WeekdayHeader],
    x: f32,
    image_width: f32,
) -> Option<u8> {
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
    let Some(stripped) = rest
        .strip_prefix('调')
        .or_else(|| rest.strip_prefix('停'))
    else {
        return false;
    };
    stripped
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count()
        >= 3
}
