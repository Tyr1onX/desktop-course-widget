fn anchor_courses(
    tokens: &[Token],
    anchors: &[CourseAnchor],
    headers: &[WeekdayHeader],
    image_width: u32,
    image_height: u32,
) -> (Vec<ImportCourse>, Vec<String>) {
    let mut courses = Vec::new();
    let mut warnings = Vec::new();
    for anchor in anchors {
        let anchor_token = &tokens[anchor.token_index];
        let column_bounds = weekday_column_bounds(headers, anchor.weekday, image_width as f32);
        let previous_anchor = anchors
            .iter()
            .filter(|candidate| {
                candidate.weekday == anchor.weekday
                    && tokens[candidate.token_index].center_y() < anchor_token.center_y()
            })
            .max_by(|left, right| {
                tokens[left.token_index]
                    .center_y()
                    .partial_cmp(&tokens[right.token_index].center_y())
                    .unwrap_or(Ordering::Equal)
            });
        let next_anchor = anchors
            .iter()
            .filter(|candidate| {
                candidate.weekday == anchor.weekday
                    && tokens[candidate.token_index].center_y() > anchor_token.center_y()
            })
            .min_by(|left, right| {
                tokens[left.token_index]
                    .center_y()
                    .partial_cmp(&tokens[right.token_index].center_y())
                    .unwrap_or(Ordering::Equal)
            });
        let header_bottom = headers
            .iter()
            .find(|header| header.weekday == anchor.weekday)
            .map(|header| header.bottom)
            .unwrap_or(0.0);
        let upper_bound = previous_anchor
            .map(|candidate| {
                (tokens[candidate.token_index].center_y() + anchor_token.center_y()) / 2.0
            })
            .unwrap_or_else(|| {
                (anchor_token.center_y() - anchor_token.height.max(24.0) * 4.5)
                    .max(header_bottom)
            });
        let lower_bound = next_anchor
            .map(|candidate| {
                (anchor_token.center_y() + tokens[candidate.token_index].center_y()) / 2.0
            })
            .unwrap_or(anchor_token.center_y() + anchor_token.height.max(24.0) * 4.5);
        let mut block = tokens
            .iter()
            .enumerate()
            .filter(|(index, token)| {
                *index != anchor.token_index
                    && token.center_x() >= column_bounds.0
                    && token.center_x() < column_bounds.1
                    && token.center_y() >= upper_bound
                    && token.center_y() < lower_bound
                    && !is_weekday_header(&token.text)
                    && section_number_from_text(&token.text).is_none()
            })
            .map(|(_, token)| token.clone())
            .collect::<Vec<_>>();
        block.sort_by(token_reading_order);
        if let Some(course) = course_from_block(
            anchor.weekday,
            anchor.start_section,
            anchor.end_section,
            anchor.weeks.clone(),
            anchor.parity.clone(),
            anchor.used_default_weeks,
            anchor_token,
            &block,
            image_width,
            image_height,
        ) {
            if anchor.used_default_weeks {
                warnings.push(format!(
                    "{} 的周次未完整识别，已暂按 1～{DEFAULT_LAST_WEEK} 周填写",
                    course.name
                ));
            }
            courses.push(course);
        }
    }
    (courses, warnings)
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
    block: &[Token],
    image_width: u32,
    image_height: u32,
) -> Option<ImportCourse> {
    let mut candidates = block.iter().chain(std::iter::once(anchor)).collect::<Vec<_>>();
    candidates.sort_by(|left, right| token_reading_order(left, right));
    let (name_token, name) = find_course_name(candidates.iter().copied())?;
    let teacher = find_teacher_fragment(candidates.iter().copied(), name_token, &name, anchor);
    let location = find_location_fragment(candidates.iter().copied());

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
        raw_text: Some(anchor.text.clone()),
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
        raw_text: Some(anchor.text.clone()),
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
