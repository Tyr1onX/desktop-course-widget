use super::types::{ParsedWorkbook, SectionTime};
use crate::schedule_store::{Course, Schedule};
use chrono::{Datelike, Duration, NaiveDate};
pub fn preview_schedule(
    parsed: &ParsedWorkbook,
    first_week_monday: &str,
    times: &[SectionTime],
) -> Result<Schedule, String> {
    let first_week_monday = NaiveDate::parse_from_str(first_week_monday, "%Y-%m-%d")
        .map_err(|_| "第一教学周日期格式必须为 YYYY-MM-DD")?;
    if first_week_monday.weekday().num_days_from_monday() != 0 {
        return Err("第一教学周日期必须是星期一".into());
    }
    let mut courses = Vec::new();
    for entry in &parsed.scheduled_entries {
        let start = times
            .iter()
            .find(|t| t.section == entry.start_section)
            .ok_or("第N节没有配置作息时间")?;
        let end = times
            .iter()
            .find(|t| t.section == entry.end_section)
            .ok_or("第N节没有配置作息时间")?;
        courses.push(Course {
            name: entry.name.clone(),
            teacher: String::new(),
            weekday: entry.weekday,
            start: start.start.clone(),
            end: end.end.clone(),
            location: entry.location.clone().unwrap_or_default(),
            weeks: entry.weeks.clone(),
            parity: entry.parity.clone(),
        });
    }
    let maximum_week = parsed
        .scheduled_entries
        .iter()
        .flat_map(|entry| entry.weeks.iter().copied())
        .max()
        .ok_or("没有可转换的已排课程")?;
    let semester_end = first_week_monday + Duration::days(i64::from(maximum_week) * 7 - 1);

    Ok(Schedule {
        schema_version: 1,
        semester_start: first_week_monday.format("%Y-%m-%d").to_string(),
        semester_end: Some(semester_end.format("%Y-%m-%d").to_string()),
        courses,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::excel_import::types::ParsedCourseEntry;

    #[test]
    fn uses_outer_section_boundaries_and_calculates_semester_end() {
        let parsed = ParsedWorkbook {
            detected_term_text: None,
            warnings: vec![],
            scheduled_entries: vec![ParsedCourseEntry {
                code: None,
                name: "Anonymous course".into(),
                weekday: 1,
                start_section: 1,
                end_section: 2,
                weeks: vec![1, 3],
                parity: "all".into(),
                location: None,
            }],
        };
        let schedule = preview_schedule(
            &parsed,
            "2026-09-07",
            &[
                SectionTime {
                    section: 1,
                    start: "08:00".into(),
                    end: "08:45".into(),
                },
                SectionTime {
                    section: 2,
                    start: "08:55".into(),
                    end: "09:40".into(),
                },
            ],
        )
        .expect("section times should convert");

        assert_eq!(schedule.courses[0].start, "08:00");
        assert_eq!(schedule.courses[0].end, "09:40");
        assert_eq!(schedule.semester_end.as_deref(), Some("2026-09-27"));
    }
}
