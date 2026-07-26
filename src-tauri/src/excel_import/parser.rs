use super::types::ParsedCourseEntry;
use regex::Regex;

pub fn parse_cell(
    text: &str,
    grid_weekday: u8,
    grid_sections: Option<(u8, u8)>,
) -> Result<Vec<ParsedCourseEntry>, String> {
    if text.contains("暂未确定") || text.trim().is_empty() {
        return Ok(vec![]);
    }
    let normalized = text
        .replace('\r', "")
        .replace('，', ",")
        .replace('－', "-")
        .replace('~', "-");
    let week_re = Regex::new(r"(?P<weeks>(?:\d+\s*(?:-|,|，)\s*)*\d+)\s*周(?:\s*[（(](?P<parity>单|双)[)）])?|(?P<short>单周|双周)").unwrap();
    let day_re = Regex::new(r"星期\s*(?P<day>[1-7])").unwrap();
    let section_re =
        Regex::new(r"第\s*(?P<start>\d+)\s*节\s*(?:-|至)\s*第?\s*(?P<end>\d+)\s*节").unwrap();
    let week_matches = week_re.find_iter(&normalized).collect::<Vec<_>>();
    if week_matches.is_empty() {
        return Ok(vec![]);
    }
    let lines = normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let title = lines
        .iter()
        .find(|line| !line.contains('周') && !line.contains("星期") && !line.contains('节'))
        .copied()
        .ok_or("课程缺少名称")?;
    let code_re = Regex::new(r"^(?P<code>[A-Za-z0-9]+)-(?P<name>.+)$").unwrap();
    let (code, name) = if let Some(c) = code_re.captures(title) {
        (Some(c["code"].to_owned()), c["name"].trim().to_owned())
    } else {
        (None, title.to_owned())
    };
    week_matches
        .iter()
        .enumerate()
        .map(|(index, week_match)| {
            let segment_end = week_matches
                .get(index + 1)
                .map(|next| next.start())
                .unwrap_or(normalized.len());
            let segment = &normalized[week_match.start()..segment_end];
            let weekday = day_re
                .captures(segment)
                .and_then(|capture| capture.name("day"))
                .and_then(|day| day.as_str().parse().ok())
                .unwrap_or(grid_weekday);
            let section_match = section_re.captures(segment);
            let sections = section_match
                .as_ref()
                .and_then(|capture| {
                    Some((
                        capture.name("start")?.as_str().parse().ok()?,
                        capture.name("end")?.as_str().parse().ok()?,
                    ))
                })
                .or(grid_sections)
                .ok_or("课程缺少节次信息")?;
            if sections.0 == 0 || sections.1 < sections.0 {
                return Err("课程节次无效".into());
            }
            let location_start = section_match
                .as_ref()
                .map(|capture| capture.get(0).expect("section regex match").end())
                .unwrap_or(week_match.end() - week_match.start());
            let prefix_location = if index == 0 {
                find_likely_location(&normalized[..week_match.start()], Some(title))
            } else {
                None
            };
            let location = normalize_location(&segment[location_start..])
                .or_else(|| find_likely_location(segment, Some(title)))
                .or(prefix_location);
            let weeks = parse_weeks(week_match.as_str())?;
            let parity = if week_match.as_str().contains('单') {
                "odd"
            } else if week_match.as_str().contains('双') {
                "even"
            } else {
                "all"
            }
            .to_owned();
            Ok(ParsedCourseEntry {
                code: code.clone(),
                name: name.clone(),
                weekday,
                start_section: sections.0,
                end_section: sections.1,
                weeks,
                parity,
                location,
            })
        })
        .collect()
}

fn normalize_location(tail: &str) -> Option<String> {
    if let Some(location) = find_likely_location(tail, None) {
        return Some(location);
    }

    let first_line = tail.lines().map(str::trim).find(|line| !line.is_empty())?;
    if looks_like_course_start(first_line) {
        return None;
    }
    let candidate = clean_location(first_line);
    if candidate.is_empty()
        || candidate == "无"
        || candidate
            .chars()
            .all(|character| character.is_ascii_punctuation() || character.is_whitespace())
    {
        None
    } else {
        Some(candidate)
    }
}

fn find_likely_location(text: &str, excluded_title: Option<&str>) -> Option<String> {
    let excluded = excluded_title.map(compact);
    text.lines()
        .flat_map(|line| line.split([',', '，', ';', '；']))
        .map(clean_location)
        .find(|candidate| {
            !candidate.is_empty()
                && excluded.as_deref() != Some(compact(candidate).as_str())
                && is_likely_location(candidate)
        })
}

fn clean_location(value: &str) -> String {
    let mut candidate = value
        .trim_matches(|character: char| {
            character.is_whitespace() || matches!(character, ',' | '，' | ';' | '；')
        })
        .split_whitespace()
        .collect::<String>();
    for prefix in ["上课地点：", "上课地点:", "地点：", "地点:"] {
        if let Some(stripped) = candidate.strip_prefix(prefix) {
            candidate = stripped.to_owned();
            break;
        }
    }
    candidate
}

fn is_likely_location(value: &str) -> bool {
    if value == "无"
        || value.contains('周')
        || value.contains("星期")
        || looks_like_course_start(value)
    {
        return false;
    }
    [
        "校区",
        "教学楼",
        "实验楼",
        "教室",
        "实验室",
        "阶",
        "楼",
        "馆",
        "场",
        "中心",
        "线上",
        "会议室",
    ]
    .iter()
    .any(|marker| value.contains(marker))
}

fn compact(value: &str) -> String {
    value.split_whitespace().collect::<String>()
}

fn looks_like_course_start(value: &str) -> bool {
    Regex::new(r"^[A-Za-z0-9]{3,}-|\[\d{2,}\]")
        .expect("course start regex")
        .is_match(value)
}

pub fn parse_weeks(value: &str) -> Result<Vec<u8>, String> {
    let clean = value
        .replace("周", "")
        .replace(['(', ')', '（', '）', '单', '双'], "")
        .replace('，', ",")
        .replace(' ', "");
    let mut out = Vec::new();
    for part in clean.split(',') {
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let a: u8 = a.parse().map_err(|_| "周数格式无效")?;
            let b: u8 = b.parse().map_err(|_| "周数格式无效")?;
            if a == 0 || b < a || b > 30 {
                return Err("周数格式无效".into());
            }
            out.extend(a..=b)
        } else {
            let n: u8 = part.parse().map_err(|_| "周数格式无效")?;
            if n == 0 || n > 30 {
                return Err("周数格式无效".into());
            }
            out.push(n)
        }
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::parse_cell;

    #[test]
    fn recovers_location_before_week_clause() {
        let entries = parse_cell(
            "课程甲[03]\n教学楼B203\n1-17周,星期1,第1节-第2节",
            1,
            Some((1, 2)),
        )
        .unwrap();
        assert_eq!(entries[0].location.as_deref(), Some("教学楼B203"));
    }

    #[test]
    fn skips_teacher_line_and_finds_following_location() {
        let entries = parse_cell(
            "课程甲\n1-17周,星期1,第1节-第2节\n教师甲\n教学楼B203",
            1,
            Some((1, 2)),
        )
        .unwrap();
        assert_eq!(entries[0].location.as_deref(), Some("教学楼B203"));
    }

    #[test]
    fn recovers_location_inside_schedule_clause() {
        let entries = parse_cell(
            "课程甲\n1-17周,教学楼B203,星期1,第1节-第2节",
            1,
            Some((1, 2)),
        )
        .unwrap();
        assert_eq!(entries[0].location.as_deref(), Some("教学楼B203"));
    }
}
