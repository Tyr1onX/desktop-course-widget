fn expand_multiline_tokens(tokens: Vec<Token>) -> Vec<Token> {
    let mut expanded = Vec::new();
    for token in tokens {
        let parts = token
            .parts
            .iter()
            .map(|part| compact_text(part))
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.len() <= 1 {
            expanded.push(token);
            continue;
        }

        let line_height = (token.height / parts.len() as f32).max(1.0);
        for (index, part) in parts.into_iter().enumerate() {
            expanded.push(Token {
                text: part.clone(),
                parts: vec![part],
                confidence: token.confidence,
                left: token.left,
                top: token.top + line_height * index as f32,
                width: token.width,
                height: line_height,
            });
        }
    }
    expanded.sort_by(token_reading_order);
    expanded
}

fn is_footer_table_header(value: &str) -> bool {
    matches!(
        compact_text(value).as_str(),
        "调停课信息"
            | "调、停（补）课信息"
            | "调停（补）课信息"
            | "实践课信息"
            | "实践课（或无上课时间）信息"
            | "实习课信息"
            | "实习时间"
            | "先修模块"
            | "未安排上课时间的课程"
            | "原上课时间地点教师"
            | "现上课时间地点教师"
            | "申请时间"
            | "课程名称"
            | "教师姓名"
            | "模块代码"
            | "学分"
            | "起止周"
    )
}

fn token_is_course_boundary(token: &Token) -> bool {
    token
        .parts
        .iter()
        .chain(std::iter::once(&token.text))
        .any(|value| {
            is_location_text(value)
                || compact_location_from_text(value).is_some()
                || looks_like_schedule_metadata(value)
                || section_range_from_text(value).is_some()
                || weekday_from_schedule_text(value).is_some()
        })
}

fn optional_field_evidence(
    field: ImportFieldKey,
    token: Option<&Token>,
    missing_reason: &str,
    image_width: u32,
    image_height: u32,
) -> ImportFieldEvidence {
    match token {
        Some(token) => field_evidence(
            field,
            ImportReviewStatus::Review,
            Some(token),
            "本地 OCR 字段需确认",
            image_width,
            image_height,
        ),
        None => ImportFieldEvidence {
            field,
            status: ImportReviewStatus::Missing,
            confidence: None,
            raw_text: None,
            source_box: None,
            reason: Some(missing_reason.into()),
        },
    }
}

fn field_evidence(
    field: ImportFieldKey,
    status: ImportReviewStatus,
    token: Option<&Token>,
    reason: &str,
    image_width: u32,
    image_height: u32,
) -> ImportFieldEvidence {
    ImportFieldEvidence {
        field,
        status,
        confidence: token.map(|token| token.confidence),
        raw_text: token.map(|token| token.text.clone()),
        source_box: token.and_then(|token| normalized_box(token, image_width, image_height)),
        reason: Some(reason.into()),
    }
}

fn normalized_box(
    token: &Token,
    image_width: u32,
    image_height: u32,
) -> Option<NormalizedImageBox> {
    if image_width == 0 || image_height == 0 {
        return None;
    }
    Some(NormalizedImageBox {
        x: (token.left / image_width as f32).clamp(0.0, 1.0),
        y: (token.top / image_height as f32).clamp(0.0, 1.0),
        width: (token.width / image_width as f32).clamp(f32::EPSILON, 1.0),
        height: (token.height / image_height as f32).clamp(f32::EPSILON, 1.0),
    })
}

fn normalized_union(
    tokens: &[Token],
    image_width: u32,
    image_height: u32,
) -> Option<NormalizedImageBox> {
    if tokens.is_empty() || image_width == 0 || image_height == 0 {
        return None;
    }
    let left = tokens
        .iter()
        .map(|token| token.left)
        .fold(f32::MAX, f32::min);
    let top = tokens
        .iter()
        .map(|token| token.top)
        .fold(f32::MAX, f32::min);
    let right = tokens.iter().map(Token::right).fold(0.0_f32, f32::max);
    let bottom = tokens.iter().map(Token::bottom).fold(0.0_f32, f32::max);
    Some(NormalizedImageBox {
        x: (left / image_width as f32).clamp(0.0, 1.0),
        y: (top / image_height as f32).clamp(0.0, 1.0),
        width: ((right - left) / image_width as f32).clamp(f32::EPSILON, 1.0),
        height: ((bottom - top) / image_height as f32).clamp(f32::EPSILON, 1.0),
    })
}

fn resolve_model_root() -> Result<PathBuf, String> {
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join(".tmp/native-ocr-models"));
    if cfg!(debug_assertions) {
        if let Some(path) = development.filter(|path| path.is_dir()) {
            return Ok(path);
        }
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("无法定位课刻程序目录：{error}"))?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| "无法定位课刻程序目录".to_owned())?;
    for bundled in [
        executable_dir.join("ocr-native"),
        executable_dir.join("resources/ocr-native"),
        executable_dir.join("_up_/resources/ocr-native"),
    ] {
        if bundled.is_dir() {
            return Ok(bundled);
        }
    }
    Err("当前安装包没有包含本地文字识别模型".into())
}

fn bounded_image(image: DynamicImage, max_side: u32) -> DynamicImage {
    if max_side == 0 || image.width().max(image.height()) <= max_side {
        return image;
    }
    image.resize(max_side, max_side, image::imageops::FilterType::Lanczos3)
}

fn validate_image_path(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("所选课表截图不存在或无法读取".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg") {
        return Err("仅支持 PNG、JPG、JPEG 课表截图".into());
    }
    Ok(())
}

fn token_reading_order(left: &Token, right: &Token) -> Ordering {
    left.top
        .partial_cmp(&right.top)
        .unwrap_or(Ordering::Equal)
        .then_with(|| {
            left.left
                .partial_cmp(&right.left)
                .unwrap_or(Ordering::Equal)
        })
}

fn compact_text(value: &str) -> String {
    value.split_whitespace().collect::<String>()
}

fn is_weekday_header(value: &str) -> bool {
    weekday_from_text(value).is_some()
}

fn weekday_from_text(value: &str) -> Option<u8> {
    let compact = compact_text(value);
    let suffix = compact
        .strip_prefix("星期")
        .or_else(|| compact.strip_prefix('周'))?;
    if suffix.chars().count() != 1 {
        return None;
    }
    weekday_character(suffix.chars().next()?)
}

fn weekday_character(value: char) -> Option<u8> {
    match value {
        '一' | '1' => Some(1),
        '二' | '2' => Some(2),
        '三' | '3' => Some(3),
        '四' | '4' => Some(4),
        '五' | '5' => Some(5),
        '六' | '6' => Some(6),
        '日' | '天' | '7' => Some(7),
        _ => None,
    }
}

fn is_time_text(value: &str) -> bool {
    Regex::new(r"^\d{1,2}[:：]\d{2}$")
        .unwrap()
        .is_match(&compact_text(value))
}

fn is_teacher_text(value: &str) -> bool {
    value.contains("老师") || value.contains("教师") || value.ends_with("教授")
}

fn is_location_text(value: &str) -> bool {
    [
        "教学楼",
        "教室",
        "校区",
        "楼",
        "室",
        "阶",
        "馆",
        "南湖",
        "南岭",
        "中心",
        "操场",
    ]
    .iter()
    .any(|marker| value.contains(marker))
}

fn is_common_header(value: &str) -> bool {
    [
        "课程",
        "课程名称",
        "教师",
        "上课地点",
        "地点",
        "节次",
        "时间",
        "星期",
        "周次",
        "教学周",
        "课表",
        "学期",
        "学分",
        "起止周",
        "上课时间",
        "申请时间",
        "编号",
        "调停课信息",
        "调、停（补）课信息",
        "调停（补）课信息",
        "实践课信息",
        "实践课（或无上课时间）信息",
        "实习课信息",
        "实习时间",
        "先修模块",
        "未安排上课时间的课程",
        "原上课时间地点教师",
        "现上课时间地点教师",
        "教师姓名",
        "模块代码",
    ]
    .contains(&value)
}

fn looks_like_schedule_metadata(value: &str) -> bool {
    (value.contains('周')
        && (value.contains('节') || value.chars().any(|character| character.is_ascii_digit())))
        || (value.contains('节') && value.chars().any(|character| character.is_ascii_digit()))
}
