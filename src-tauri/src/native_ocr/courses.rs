fn anchor_courses(
    tokens: &[Token],
    anchors: &[CourseAnchor],
    headers: &[WeekdayHeader],
    image_width: u32,
    image_height: u32,
) -> (Vec<ImportCourse>, Vec<String>) {
    let mut courses = Vec::new();
    let mut warnings = Vec::new();
    let seeds = course_card_seeds(tokens, anchors, headers, image_width as f32);

    for (anchor_index, anchor) in anchors.iter().enumerate() {
        if seeds
            .get(anchor_index)
            .is_some_and(|seed| seed.auxiliary)
        {
            continue;
        }
        let anchor_token = &tokens[anchor.token_index];
        let card = course_card_geometry(
            tokens,
            anchors,
            &seeds,
            anchor_index,
            headers,
            image_width as f32,
        );
        let mut block = tokens
            .iter()
            .enumerate()
            .filter(|(index, token)| {
                *index != anchor.token_index
                    && token.center_x() >= card.column_bounds.0
                    && token.center_x() < card.column_bounds.1
                    && token.center_y() >= card.upper_bound
                    && token.center_y() < card.lower_bound
                    && !is_weekday_header(&token.text)
                    && section_number_from_text(&token.text).is_none()
                    && !token_has_auxiliary_annotation(token)
            })
            .map(|(_, token)| token.clone())
            .collect::<Vec<_>>();
        block.sort_by(token_reading_order);
        if let Some(course) = course_from_block(
            card.weekday,
            anchor.start_section,
            anchor.end_section,
            anchor.weeks.clone(),
            anchor.parity.clone(),
            anchor.used_default_weeks,
            anchor_token,
            &anchor.metadata_text,
            &block,
            image_width,
            image_height,
        ) {
            if anchor.used_default_weeks {
                warnings.push(fallback_week_warning(&course.name, &course.weeks));
            }
            courses.push(course);
        }
    }
    (courses, warnings)
}

fn fallback_week_warning(course_name: &str, weeks: &[u8]) -> String {
    let fallback_last_week = weeks.iter().copied().max().unwrap_or(DEFAULT_LAST_WEEK);
    format!(
        "{course_name} 的周次未完整识别，已暂按 1～{fallback_last_week} 周填写"
    )
}

#[allow(clippy::too_many_arguments)]
fn course_from_block(
    weekday: u8,
    start_section: u8,
    end_section: u8,
    weeks: Vec<u8>,
    parity: String,
    default_weeks: bool,
    anchor: &Token,
    anchor_text: &str,
    block: &[Token],
    image_width: u32,
    image_height: u32,
) -> Option<ImportCourse> {
    let mut candidates = block.iter().chain(std::iter::once(anchor)).collect::<Vec<_>>();
    candidates.sort_by(|left, right| token_reading_order(left, right));
    let name_candidates = card_name_candidates(&candidates, anchor);
    let (name_token, name) = find_course_name(name_candidates.iter().copied(), anchor)?;
    // Adjustment/cancellation rows are auxiliary timetable metadata, never a real
    // course arrangement. Keep this output-boundary guard even when seed detection has
    // already filtered most of them: OCR can place the marker far enough from the
    // schedule line that geometric association is uncertain.
    if is_auxiliary_course_annotation(&name) || token_has_auxiliary_annotation(name_token) {
        return None;
    }
    let field_candidates = candidates
        .iter()
        .copied()
        .filter(|token| token.center_y() >= name_token.center_y() - 1.0)
        .collect::<Vec<_>>();
    let teacher = find_teacher_after_schedule(field_candidates.iter().copied(), &name, anchor)
        .or_else(|| {
            find_teacher_fragment(
                field_candidates.iter().copied(),
                name_token,
                &name,
                anchor,
            )
        });
    let after_anchor = field_candidates
        .iter()
        .copied()
        .filter(|token| token.center_y() >= anchor.center_y() - 1.0)
        .collect::<Vec<_>>();
    let location = find_location_in_schedule_token(anchor)
        .or_else(|| find_location_after_schedule(after_anchor.iter().copied(), anchor))
        .or_else(|| find_location_fragment(field_candidates.iter().copied()))
        .or_else(|| find_compact_location(field_candidates.iter().copied()));

    let mut source_tokens = vec![anchor.clone()];
    source_tokens.extend(block.iter().cloned());
    let source_box = normalized_union(&source_tokens, image_width, image_height);

    let mut fields = vec![field_evidence(
        ImportFieldKey::Name,
        ImportReviewStatus::Review,
        Some(name_token),
        "本地 OCR 课程名称需确认",
        image_width,
        image_height,
    )];
    fields.push(optional_field_evidence(
        ImportFieldKey::Teacher,
        teacher.as_ref().map(|(token, _)| *token),
        "未识别到老师，可留空",
        image_width,
        image_height,
    ));
    fields.push(optional_field_evidence(
        ImportFieldKey::Location,
        location.as_ref().map(|(token, _)| *token),
        "未识别到地点，可留空",
        image_width,
        image_height,
    ));
    fields.push(ImportFieldEvidence {
        field: ImportFieldKey::Weeks,
        status: ImportReviewStatus::Review,
        confidence: Some(anchor.confidence),
        raw_text: Some(anchor_text.to_owned()),
        source_box: normalized_box(anchor, image_width, image_height),
        reason: Some(if default_weeks {
            "周次未完整识别，已填入默认范围，请修改后确认".into()
        } else {
            "本地 OCR 周次需确认".into()
        }),
    });
    fields.push(ImportFieldEvidence {
        field: ImportFieldKey::Parity,
        status: ImportReviewStatus::Review,
        confidence: Some(anchor.confidence),
        raw_text: Some(anchor_text.to_owned()),
        source_box: normalized_box(anchor, image_width, image_height),
        reason: Some("本地 OCR 单双周需确认".into()),
    });

    Some(ImportCourse {
        code: None,
        name,
        teacher: teacher.map(|(_, value)| value),
        weekday,
        start_section,
        end_section,
        weeks,
        parity,
        location: location.map(|(_, value)| value),
        review: Some(ImportCourseReview { source_box, fields }),
    })
}

fn card_name_candidates<'a>(candidates: &[&'a Token], anchor: &'a Token) -> Vec<&'a Token> {
    let mut ordered = candidates.to_vec();
    ordered.sort_by(|left, right| token_reading_order(left, right));

    let mut excluded = std::collections::HashSet::new();
    let before_anchor = ordered
        .iter()
        .copied()
        .filter(|token| token.center_y() < anchor.center_y() - 0.5)
        .collect::<Vec<_>>();

    for pair in before_anchor.windows(2) {
        let previous = pair[0];
        let current = pair[1];
        let Some(previous_name) = name_fragment_from_token(previous) else {
            continue;
        };
        let Some(current_name) = name_fragment_from_token(current) else {
            continue;
        };
        let previous_is_strong_title = has_course_code(&previous_name)
            || previous_name.chars().count() >= 5
            || !is_bare_teacher_name(&previous_name);
        let current_is_narrow_bare_name = is_bare_teacher_name(&current_name)
            && current.width <= previous.width.max(1.0) * 0.72;
        let vertical_gap = current.top - previous.bottom();
        let nearby = vertical_gap
            <= previous.height.max(current.height).max(18.0) * 1.6 + 8.0;
        if previous_is_strong_title && current_is_narrow_bare_name && nearby {
            excluded.insert(current as *const Token as usize);
        }
    }

    ordered
        .into_iter()
        .filter(|token| !excluded.contains(&(*token as *const Token as usize)))
        .collect()
}

fn title_start_before_anchor(
    tokens: &[Token],
    column_bounds: (f32, f32),
    lower_limit: f32,
    anchor: &Token,
) -> Option<f32> {
    let mut candidates = tokens
        .iter()
        .filter(|token| {
            token.center_x() >= column_bounds.0
                && token.center_x() < column_bounds.1
                && token.center_y() > lower_limit + 0.5
                && token.center_y() < anchor.center_y() - 0.5
                && !token_has_auxiliary_annotation(token)
        })
        .filter_map(|token| name_fragment_from_token(token).map(|name| (token, name)))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| token_reading_order(left.0, right.0));
    let mut first_index = candidates.len().checked_sub(1)?;
    while first_index > 0 && candidates.len() - first_index < 4 {
        let (previous, previous_name) = &candidates[first_index - 1];
        let (current, current_name) = &candidates[first_index];
        let typical_height = previous.height.max(current.height).max(18.0);
        let vertical_gap = current.top - previous.bottom();
        let has_boundary_between = tokens.iter().any(|candidate| {
            candidate.center_x() >= column_bounds.0
                && candidate.center_x() < column_bounds.1
                && candidate.center_y() > previous.center_y() + 0.5
                && candidate.center_y() < current.center_y() - 0.5
                && token_is_course_boundary(candidate)
        });
        if vertical_gap > typical_height * 1.35 + 8.0
            || vertical_gap < -typical_height * 0.8
            || has_boundary_between
            || (is_bare_teacher_name(previous_name) && current_name.chars().count() > 4)
        {
            break;
        }
        first_index -= 1;
    }
    Some(candidates[first_index].0.top)
}
