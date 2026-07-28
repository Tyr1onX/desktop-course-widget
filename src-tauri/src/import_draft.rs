use serde::{Deserialize, Serialize};

use crate::excel_import::types::{ParsedCourseEntry, ParsedWorkbook};

const IMPORT_DRAFT_SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportSource {
    Excel,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportCourse {
    pub code: Option<String>,
    pub name: String,
    #[serde(default)]
    pub teacher: Option<String>,
    pub weekday: u8,
    pub start_section: u8,
    pub end_section: u8,
    pub weeks: Vec<u8>,
    pub parity: String,
    pub location: Option<String>,
}

impl From<ParsedCourseEntry> for ImportCourse {
    fn from(entry: ParsedCourseEntry) -> Self {
        Self {
            code: entry.code,
            name: entry.name,
            teacher: None,
            weekday: entry.weekday,
            start_section: entry.start_section,
            end_section: entry.end_section,
            weeks: entry.weeks,
            parity: entry.parity,
            location: entry.location,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportDraftSummary {
    pub arrangements: usize,
    pub highest_week: u8,
    pub location_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportDraft {
    pub schema_version: u8,
    pub source: ImportSource,
    pub source_name: String,
    pub suggested_name: String,
    pub detected_term_text: Option<String>,
    pub summary: ImportDraftSummary,
    pub warnings: Vec<String>,
    pub courses: Vec<ImportCourse>,
}

impl ImportDraft {
    pub fn from_excel(source_name: String, parsed: ParsedWorkbook) -> Self {
        let ParsedWorkbook {
            detected_term_text,
            scheduled_entries,
            warnings,
        } = parsed;
        let courses = scheduled_entries
            .into_iter()
            .map(ImportCourse::from)
            .collect::<Vec<_>>();
        let suggested_name = detected_term_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| source_stem(&source_name));
        let summary = summarize(&courses);

        Self {
            schema_version: IMPORT_DRAFT_SCHEMA_VERSION,
            source: ImportSource::Excel,
            source_name,
            suggested_name,
            detected_term_text,
            summary,
            warnings,
            courses,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != IMPORT_DRAFT_SCHEMA_VERSION {
            return Err("导入草稿版本不受支持".into());
        }
        if self.source_name.trim().is_empty() {
            return Err("导入来源名称不能为空".into());
        }
        if self.courses.is_empty() {
            return Err("没有可创建的课程安排".into());
        }

        for (index, course) in self.courses.iter().enumerate() {
            let label = index + 1;
            if course.name.trim().is_empty() {
                return Err(format!("第 {label} 项课程名称不能为空"));
            }
            if !(1..=7).contains(&course.weekday) {
                return Err(format!("第 {label} 项课程的星期无效"));
            }
            if course.start_section == 0 || course.end_section < course.start_section {
                return Err(format!("第 {label} 项课程的节次范围无效"));
            }
            if course.weeks.is_empty() || course.weeks.iter().any(|week| !(1..=30).contains(week)) {
                return Err(format!("第 {label} 项课程的教学周无效"));
            }
            if !matches!(course.parity.as_str(), "all" | "odd" | "even") {
                return Err(format!("第 {label} 项课程的单双周设置无效"));
            }
        }
        Ok(())
    }
}

fn summarize(courses: &[ImportCourse]) -> ImportDraftSummary {
    ImportDraftSummary {
        arrangements: courses.len(),
        highest_week: courses
            .iter()
            .flat_map(|course| course.weeks.iter().copied())
            .max()
            .unwrap_or(0),
        location_count: courses
            .iter()
            .filter(|course| {
                course
                    .location
                    .as_deref()
                    .is_some_and(|location| !location.trim().is_empty())
            })
            .count(),
    }
}

fn source_stem(source_name: &str) -> String {
    let trimmed = source_name.trim();
    if trimmed.to_ascii_lowercase().ends_with(".xlsx") {
        trimmed[..trimmed.len() - 5].to_owned()
    } else if trimmed.is_empty() {
        "新课表".into()
    } else {
        trimmed.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed_course() -> ParsedCourseEntry {
        ParsedCourseEntry {
            code: Some("CS101".into()),
            name: "程序设计".into(),
            weekday: 2,
            start_section: 1,
            end_section: 2,
            weeks: vec![1, 2, 3],
            parity: "all".into(),
            location: Some("A101".into()),
        }
    }

    #[test]
    fn converts_excel_result_into_source_neutral_draft() {
        let draft = ImportDraft::from_excel(
            "我的课表.xlsx".into(),
            ParsedWorkbook {
                detected_term_text: None,
                scheduled_entries: vec![parsed_course()],
                warnings: vec!["示例提示".into()],
            },
        );

        assert_eq!(draft.source, ImportSource::Excel);
        assert_eq!(draft.suggested_name, "我的课表");
        assert_eq!(draft.summary.arrangements, 1);
        assert_eq!(draft.summary.highest_week, 3);
        assert_eq!(draft.summary.location_count, 1);
        assert_eq!(draft.courses[0].teacher, None);
        assert!(draft.validate().is_ok());
    }

    #[test]
    fn rejects_invalid_course_coordinates() {
        let mut draft = ImportDraft::from_excel(
            "课表.xlsx".into(),
            ParsedWorkbook {
                detected_term_text: None,
                scheduled_entries: vec![parsed_course()],
                warnings: vec![],
            },
        );
        draft.courses[0].weekday = 8;
        assert_eq!(draft.validate().unwrap_err(), "第 1 项课程的星期无效");
    }
}
