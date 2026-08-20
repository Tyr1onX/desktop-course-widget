fn anchor_courses(
    tokens: &[Token],
    anchors: &[CourseAnchor],
    headers: &[WeekdayHeader],
    image_width: u32,
    image_height: u32,
) -> (Vec<ImportCourse>, Vec<String>) {
    let mut courses = Vec::new();
    let mut warnings = Vec::new();
    let mut structurally_dropped_auxiliary = 0_usize;
    let seeds = course_card_seeds(tokens, anchors, headers, image_width as f32);

    for (anchor_index, anchor) in anchors.iter().enumerate() {
        let seed = &seeds[anchor_index];
        let anchor_token = &tokens[anchor.token_index];
        if course_seed_is_structurally_auxiliary(
            tokens,
            anchor,
            seed,
            headers,
            image_width as f32,
        ) {
            structurally_dropped_auxiliary += 1;
            continue;
        }

        // A trailing red 调/停 marker is annotation on a real timetable arrangement,
        // not permission to drop that arrangement. Only a marker that geometrically
        // owns this schedule anchor is filtered above. Auxiliary text is still excluded
        // from field extraction and fuzzy OCR duplicates are cleaned up afterwards.
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
            if looks_like_auxiliary_course_name(&course.name) {
                continue;
            }
            if anchor.used_default_weeks {
                warnings.push(fallback_week_warning(&course.name, &course.weeks));
            }
            courses.push(course);
        }
    }

    if structurally_dropped_auxiliary > 0 {
        warnings.push(format!(
            "已忽略 {structurally_dropped_auxiliary} 条调课/停课辅助记录"
        ));
    }

    let dropped_auxiliary = drop_auxiliary_duplicate_rows(&mut courses);
    if dropped_auxiliary > 0 {
        warnings.push(format!(
            "已忽略 {dropped_auxiliary} 条与正式课程重复的调课/停课辅助记录"
        ));
    }

    let completed_names = complete_unique_truncated_course_names(&mut courses);
    if completed_names > 0 {
        warnings.push(format!(
            "有 {completed_names} 个截断课程名由同表唯一完整名称补全，请在创建前确认"
        ));
    }

    let filled_locations = fill_unique_coded_course_locations(&mut courses);
    if filled_locations > 0 {
        warnings.push(format!(
            "有 {filled_locations} 个地点由同课程其他时段的唯一一致地点补全，请在创建前确认"
        ));
    }
    (courses, warnings)
}

fn course_seed_is_structurally_auxiliary(
    tokens: &[Token],
    anchor: &CourseAnchor,
    seed: &CourseCardSeed,
    headers: &[WeekdayHeader],
    image_width: f32,
) -> bool {
    if !seed.auxiliary {
        return false;
    }

    let anchor_token = &tokens[anchor.token_index];
    if token_has_auxiliary_annotation(anchor_token) {
        // Direct parser tests can still provide one multiline token. Keep a real
        // course card when it contains a normal title before the schedule and merely
        // trails an annotation; an auxiliary-leading token remains filtered.
        return !token_contains_embedded_course_title(anchor_token);
    }

    let column_step = estimated_weekday_step(headers, image_width);
    let maximum_gap = anchor_token.height.max(18.0) * 5.0 + 28.0;
    tokens.iter().any(|marker| {
        if std::ptr::eq(marker, anchor_token)
            || !token_has_auxiliary_annotation(marker)
            || marker.center_y() >= anchor_token.center_y() - 0.5
        {
            return false;
        }

        let vertical_gap = anchor_token.top - marker.bottom();
        if vertical_gap < -marker.height.max(anchor_token.height) * 0.6
            || vertical_gap > maximum_gap
        {
            return false;
        }
        if horizontal_interval_gap(anchor_token, marker) > column_step * 0.36
            && (anchor_token.center_x() - marker.center_x()).abs() > column_step * 0.72
        {
            return false;
        }

        let schedule_boundary_between = tokens.iter().any(|between| {
            !std::ptr::eq(between, anchor_token)
                && !std::ptr::eq(between, marker)
                && between.center_y() > marker.center_y() + 0.5
                && between.center_y() < anchor_token.center_y() - 0.5
                && horizontally_related(anchor_token, between)
                && weekday_from_schedule_text(&between.text).is_some()
                && section_range_from_text(&between.text).is_some()
        });
        if schedule_boundary_between {
            return false;
        }

        // A new normal title between the marker and this schedule anchor starts a new
        // card. Short all-Chinese course titles overlap the bare-teacher grammar, so
        // geometry must disambiguate a wider title followed by a narrower teacher line.
        !normal_card_boundary_between(tokens, marker, anchor_token)
    })
}

fn normal_card_boundary_between(tokens: &[Token], marker: &Token, anchor: &Token) -> bool {
    let mut candidates = tokens
        .iter()
        .filter(|token| {
            !std::ptr::eq(*token, anchor)
                && !std::ptr::eq(*token, marker)
                && token.center_y() > marker.center_y() + 0.5
                && token.center_y() < anchor.center_y() - 0.5
                && horizontally_related(anchor, token)
                && !token_has_auxiliary_annotation(token)
        })
        .filter_map(|token| name_fragment_from_token(token).map(|name| (token, name)))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| token_reading_order(left.0, right.0));

    for (index, (candidate, name)) in candidates.iter().enumerate() {
        if !is_bare_teacher_name(name) {
            return true;
        }

        let Some((next, next_name)) = candidates.get(index + 1) else {
            continue;
        };
        let typical_height = candidate.height.max(next.height).max(18.0);
        let vertical_gap = next.top - candidate.bottom();
        let nearby = vertical_gap >= -typical_height * 0.8
            && vertical_gap <= typical_height * 1.6 + 8.0;
        let narrower_teacher = is_bare_teacher_name(next_name)
            && next.width <= candidate.width.max(1.0) * 0.72;
        if nearby && narrower_teacher {
            return true;
        }
    }
    false
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
    // The OCR token that contains a valid course title may also contain a red
    // 调/停 annotation. Reject only when the parsed title itself is an auxiliary
    // row; do not reject a valid arrangement because its source token is annotated.
    if looks_like_auxiliary_course_name(&name) {
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

fn looks_like_auxiliary_course_name(value: &str) -> bool {
    if is_auxiliary_course_annotation(value) {
        return true;
    }
    let compact = compact_text(value);
    Regex::new(r"(?:^|[（(])(?:调|停)[0-9０-９OoIl]{3,8}")
        .unwrap()
        .is_match(&compact)
}

fn auxiliary_base_course_name(value: &str) -> Option<String> {
    let compact = compact_text(value);
    let bracketed = Regex::new(
        r"^[（(][^0-9０-９OoIl]{0,2}[0-9０-９OoIl]{3,8}[)）]?(.+)$",
    )
    .unwrap();
    let explicit = Regex::new(r"^(?:调|停)[0-9０-９OoIl]{3,8}[)）]?(.+)$").unwrap();
    for pattern in [&bracketed, &explicit] {
        if let Some(captures) = pattern.captures(&compact) {
            let remainder = captures.get(1)?.as_str().trim();
            if remainder.chars().count() >= 2 {
                return Some(remainder.to_owned());
            }
        }
    }
    None
}

fn drop_auxiliary_duplicate_rows(courses: &mut Vec<ImportCourse>) -> usize {
    let normal_names = courses
        .iter()
        .filter(|course| auxiliary_base_course_name(&course.name).is_none())
        .map(|course| compact_text(&course.name))
        .collect::<std::collections::HashSet<_>>();
    let before = courses.len();
    courses.retain(|course| {
        let Some(base) = auxiliary_base_course_name(&course.name) else {
            return true;
        };
        !normal_names.contains(&compact_text(&base))
    });
    before.saturating_sub(courses.len())
}

fn complete_unique_truncated_course_names(courses: &mut [ImportCourse]) -> usize {
    let names = courses
        .iter()
        .map(|course| course.name.clone())
        .collect::<Vec<_>>();
    let mut completions = Vec::new();

    for (index, course) in courses.iter().enumerate() {
        let compact = compact_text(&course.name);
        let looks_truncated = ["（混", "（混合", "(混", "(混合"]
            .iter()
            .any(|suffix| compact.ends_with(suffix));
        if !looks_truncated {
            continue;
        }

        let candidates = names
            .iter()
            .filter(|name| {
                let candidate = compact_text(name);
                candidate.len() > compact.len() && candidate.starts_with(&compact)
            })
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        if candidates.len() == 1 {
            if let Some(name) = candidates.into_iter().next() {
                completions.push((index, name));
            }
        }
    }

    let count = completions.len();
    for (index, name) in completions {
        let course = &mut courses[index];
        course.name = name.clone();
        if let Some(review) = course.review.as_mut() {
            if let Some(field) = review
                .fields
                .iter_mut()
                .find(|field| field.field == ImportFieldKey::Name)
            {
                field.status = ImportReviewStatus::Review;
                field.confidence = None;
                field.raw_text = Some(name);
                field.source_box = None;
                field.reason = Some("课程名在该时段被截断，已由同表唯一完整名称补全".into());
            }
        }
    }
    count
}

fn fill_unique_coded_course_locations(courses: &mut [ImportCourse]) -> usize {
    let mut fills = Vec::new();
    for (index, course) in courses.iter().enumerate() {
        if course
            .location
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
            || !has_course_code(&course.name)
        {
            continue;
        }

        let course_key = compact_text(&course.name);
        let mut known_locations = std::collections::BTreeSet::new();
        for sibling in courses.iter() {
            if compact_text(&sibling.name) != course_key {
                continue;
            }
            if let Some(location) = sibling
                .location
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                known_locations.insert(location.to_owned());
            }
        }

        // Only propagate when every recognized arrangement of the same coded course
        // agrees on one location. If the course genuinely uses multiple rooms, leave
        // missing fields untouched rather than guessing.
        if known_locations.len() == 1 {
            if let Some(location) = known_locations.into_iter().next() {
                fills.push((index, location));
            }
        }
    }

    let fill_count = fills.len();
    for (index, location) in fills {
        let course = &mut courses[index];
        course.location = Some(location.clone());
        if let Some(review) = course.review.as_mut() {
            if let Some(field) = review
                .fields
                .iter_mut()
                .find(|field| field.field == ImportFieldKey::Location)
            {
                field.status = ImportReviewStatus::Review;
                field.confidence = None;
                field.raw_text = Some(location);
                field.source_box = None;
                field.reason = Some(
                    "同一带课程代码的课程在其他时段只识别到一个一致地点，已作为候选补全"
                        .into(),
                );
            }
        }
    }
    fill_count
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
        let short_title_teacher_pair = is_bare_teacher_name(&previous_name)
            && is_bare_teacher_name(&current_name)
            && current.width <= previous.width.max(1.0) * 0.72;
        let previous_is_strong_title = has_course_code(&previous_name)
            || previous_name.chars().count() >= 5
            || !is_bare_teacher_name(&previous_name)
            || short_title_teacher_pair;
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
