use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::excel_import::types::{ParsedCourseEntry, ParsedWorkbook};

const IMPORT_DRAFT_SCHEMA_VERSION: u8 = 1;
const MAX_REVIEW_TEXT: usize = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportSource {
    Excel,
    Image,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ImportFieldKey {
    Name,
    Teacher,
    Weekday,
    StartSection,
    EndSection,
    Weeks,
    Parity,
    Location,
}

impl ImportFieldKey {
    fn label(self) -> &'static str {
        match self {
            Self::Name => "课程名称",
            Self::Teacher => "老师",
            Self::Weekday => "星期",
            Self::StartSection => "开始节次",
            Self::EndSection => "结束节次",
            Self::Weeks => "教学周",
            Self::Parity => "单双周",
            Self::Location => "地点",
        }
    }

    fn required(self) -> bool {
        matches!(
            self,
            Self::Name
                | Self::Weekday
                | Self::StartSection
                | Self::EndSection
                | Self::Weeks
                | Self::Parity
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportReviewStatus {
    Confirmed,
    Review,
    Missing,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedImageBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl NormalizedImageBox {
    fn validate(self, label: &str) -> Result<(), String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|value| !value.is_finite())
        {
            return Err(format!("{label}坐标必须是有限数字"));
        }
        if self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.x > 1.0
            || self.y > 1.0
            || self.width > 1.0
            || self.height > 1.0
            || self.x + self.width > 1.0 + f32::EPSILON
            || self.y + self.height > 1.0 + f32::EPSILON
        {
            return Err(format!("{label}坐标必须位于原图归一化范围 0～1 内"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportFieldEvidence {
    pub field: ImportFieldKey,
    pub status: ImportReviewStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_text: Option<String>,
    #[serde(default, rename = "box", skip_serializing_if = "Option::is_none")]
    pub source_box: Option<NormalizedImageBox>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl ImportFieldEvidence {
    fn validate(&self, course_number: usize) -> Result<(), String> {
        if let Some(confidence) = self.confidence {
            if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
                return Err(format!(
                    "第 {course_number} 项课程的{}置信度必须位于 0～1",
                    self.field.label()
                ));
            }
        }
        if let Some(source_box) = self.source_box {
            source_box.validate(&format!(
                "第 {course_number} 项课程的{}识别框",
                self.field.label()
            ))?;
        }
        for (kind, value) in [("原始文本", &self.raw_text), ("原因", &self.reason)] {
            if value
                .as_deref()
                .is_some_and(|text| text.chars().count() > MAX_REVIEW_TEXT)
            {
                return Err(format!(
                    "第 {course_number} 项课程的{}{kind}过长",
                    self.field.label()
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportCourseReview {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_box: Option<NormalizedImageBox>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<ImportFieldEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageSource {
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekday_columns: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section_rows: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recognizer_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<ImportCourseReview>,
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
            review: None,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportIssueSeverity {
    Error,
    Warning,
    Review,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub severity: ImportIssueSeverity,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub course_index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<ImportFieldKey>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_course_indexes: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_source: Option<ImportImageSource>,
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
            image_source: None,
        }
    }

    pub fn issues(&self) -> Vec<ImportIssue> {
        if self.courses.is_empty() {
            return vec![ImportIssue {
                severity: ImportIssueSeverity::Error,
                code: "courses.empty".into(),
                message: "没有可创建的课程安排".into(),
                course_index: None,
                field: None,
                related_course_indexes: vec![],
            }];
        }

        let mut issues = Vec::new();
        for (index, course) in self.courses.iter().enumerate() {
            if course.name.trim().is_empty() {
                push_issue(
                    &mut issues,
                    ImportIssueSeverity::Error,
                    "course.name.empty",
                    "课程名称不能为空",
                    index,
                    Some(ImportFieldKey::Name),
                );
            }
            if !(1..=7).contains(&course.weekday) {
                push_issue(
                    &mut issues,
                    ImportIssueSeverity::Error,
                    "course.weekday.invalid",
                    "星期无效",
                    index,
                    Some(ImportFieldKey::Weekday),
                );
            }
            if course.start_section == 0 || course.end_section < course.start_section {
                push_issue(
                    &mut issues,
                    ImportIssueSeverity::Error,
                    "course.sections.invalid",
                    "节次范围无效",
                    index,
                    Some(ImportFieldKey::StartSection),
                );
            }
            if course.weeks.is_empty()
                || course.weeks.iter().any(|week| !(1..=30).contains(week))
            {
                push_issue(
                    &mut issues,
                    ImportIssueSeverity::Error,
                    "course.weeks.invalid",
                    "教学周无效",
                    index,
                    Some(ImportFieldKey::Weeks),
                );
            }
            if !matches!(course.parity.as_str(), "all" | "odd" | "even") {
                push_issue(
                    &mut issues,
                    ImportIssueSeverity::Error,
                    "course.parity.invalid",
                    "单双周设置无效",
                    index,
                    Some(ImportFieldKey::Parity),
                );
            }

            for evidence in course
                .review
                .as_ref()
                .into_iter()
                .flat_map(|review| &review.fields)
            {
                match evidence.status {
                    ImportReviewStatus::Confirmed => {}
                    ImportReviewStatus::Review => push_issue(
                        &mut issues,
                        ImportIssueSeverity::Review,
                        "review.field.unconfirmed",
                        &format!(
                            "{}需要确认{}",
                            evidence.field.label(),
                            evidence
                                .reason
                                .as_deref()
                                .map(|reason| format!("：{reason}"))
                                .unwrap_or_default()
                        ),
                        index,
                        Some(evidence.field),
                    ),
                    ImportReviewStatus::Missing if evidence.field.required() => push_issue(
                        &mut issues,
                        ImportIssueSeverity::Review,
                        "review.field.requiredMissing",
                        &format!("{}缺失，请补充后确认", evidence.field.label()),
                        index,
                        Some(evidence.field),
                    ),
                    ImportReviewStatus::Missing => push_issue(
                        &mut issues,
                        ImportIssueSeverity::Warning,
                        "review.field.optionalMissing",
                        &format!("{}未识别，可留空", evidence.field.label()),
                        index,
                        Some(evidence.field),
                    ),
                }
            }
        }
        issues.extend(conflict_issues(&self.courses));
        issues
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != IMPORT_DRAFT_SCHEMA_VERSION {
            return Err("导入草稿版本不受支持".into());
        }
        if self.source_name.trim().is_empty() {
            return Err("导入来源名称不能为空".into());
        }
        if let Some(image_source) = &self.image_source {
            if image_source.width == 0 || image_source.height == 0 {
                return Err("图片来源宽高必须大于 0".into());
            }
            if image_source.weekday_columns == Some(0) || image_source.section_rows == Some(0) {
                return Err("图片网格行列数量必须大于 0".into());
            }
            if image_source
                .recognizer_version
                .as_deref()
                .is_some_and(|value| value.chars().count() > 80)
            {
                return Err("识别器版本文本过长".into());
            }
        }

        for (index, course) in self.courses.iter().enumerate() {
            let course_number = index + 1;
            if let Some(review) = &course.review {
                if let Some(source_box) = review.source_box {
                    source_box.validate(&format!("第 {course_number} 项课程块"))?;
                }
                let mut fields = HashSet::new();
                for evidence in &review.fields {
                    if !fields.insert(evidence.field) {
                        return Err(format!(
                            "第 {course_number} 项课程的{}存在重复识别证据",
                            evidence.field.label()
                        ));
                    }
                    evidence.validate(course_number)?;
                }
            }
        }

        if let Some(issue) = self.issues().into_iter().find(|issue| {
            matches!(
                issue.severity,
                ImportIssueSeverity::Error | ImportIssueSeverity::Review
            )
        }) {
            return Err(match issue.course_index {
                Some(index) => format!("第 {} 项课程：{}", index + 1, issue.message),
                None => issue.message,
            });
        }
        Ok(())
    }
}

fn push_issue(
    issues: &mut Vec<ImportIssue>,
    severity: ImportIssueSeverity,
    code: &str,
    message: &str,
    course_index: usize,
    field: Option<ImportFieldKey>,
) {
    issues.push(ImportIssue {
        severity,
        code: code.into(),
        message: message.into(),
        course_index: Some(course_index),
        field,
        related_course_indexes: vec![],
    });
}

fn conflict_issues(courses: &[ImportCourse]) -> Vec<ImportIssue> {
    let mut issues = Vec::new();
    for left_index in 0..courses.len() {
        let left = &courses[left_index];
        for right_index in left_index + 1..courses.len() {
            let right = &courses[right_index];
            if left.weekday != right.weekday
                || left.start_section > right.end_section
                || right.start_section > left.end_section
            {
                continue;
            }
            let right_weeks = active_weeks(right).collect::<HashSet<_>>();
            let overlapping = active_weeks(left)
                .filter(|week| right_weeks.contains(week))
                .collect::<Vec<_>>();
            if overlapping.is_empty() {
                continue;
            }
            issues.push(ImportIssue {
                severity: ImportIssueSeverity::Warning,
                code: "course.time.conflict".into(),
                message: format!(
                    "第 {} 项与第 {} 项在第 {} 周的节次重叠",
                    left_index + 1,
                    right_index + 1,
                    overlapping
                        .iter()
                        .map(u8::to_string)
                        .collect::<Vec<_>>()
                        .join("、")
                ),
                course_index: Some(left_index),
                field: None,
                related_course_indexes: vec![left_index, right_index],
            });
        }
    }
    issues
}

fn active_weeks(course: &ImportCourse) -> impl Iterator<Item = u8> + '_ {
    course
        .weeks
        .iter()
        .copied()
        .filter(|week| match course.parity.as_str() {
            "odd" => week % 2 == 1,
            "even" => week % 2 == 0,
            _ => true,
        })
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
    use crate::excel_import::{converter::preview_import_schedule, types::SectionTime};
    use serde_json::json;

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

    fn excel_draft() -> ImportDraft {
        ImportDraft::from_excel(
            "我的课表.xlsx".into(),
            ParsedWorkbook {
                detected_term_text: None,
                scheduled_entries: vec![parsed_course()],
                warnings: vec!["示例提示".into()],
            },
        )
    }

    fn image_draft(status: ImportReviewStatus) -> ImportDraft {
        let mut draft = excel_draft();
        draft.source = ImportSource::Image;
        draft.source_name = "课表.png".into();
        draft.image_source = Some(ImportImageSource {
            width: 1200,
            height: 1800,
            weekday_columns: Some(7),
            section_rows: Some(10),
            recognizer_version: Some("fixture-v1".into()),
        });
        draft.courses[0].review = Some(ImportCourseReview {
            source_box: Some(NormalizedImageBox {
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.2,
            }),
            fields: vec![ImportFieldEvidence {
                field: ImportFieldKey::Name,
                status,
                confidence: Some(0.72),
                raw_text: Some("程序设计".into()),
                source_box: Some(NormalizedImageBox {
                    x: 0.12,
                    y: 0.22,
                    width: 0.2,
                    height: 0.05,
                }),
                reason: Some("低于自动确认阈值".into()),
            }],
        });
        draft
    }

    #[test]
    fn excel_draft_remains_valid_without_review_metadata() {
        let draft = excel_draft();
        assert_eq!(draft.source, ImportSource::Excel);
        assert_eq!(draft.suggested_name, "我的课表");
        assert_eq!(draft.courses[0].review, None);
        assert_eq!(draft.image_source, None);
        assert!(draft.validate().is_ok());
    }

    #[test]
    fn image_evidence_round_trips() {
        let draft = image_draft(ImportReviewStatus::Confirmed);
        let bytes = serde_json::to_vec(&draft).unwrap();
        let decoded: ImportDraft = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded, draft);
        assert!(decoded.validate().is_ok());
    }

    #[test]
    fn rejects_confidence_outside_normalized_range() {
        let mut draft = image_draft(ImportReviewStatus::Confirmed);
        draft.courses[0].review.as_mut().unwrap().fields[0].confidence = Some(1.01);
        assert!(draft.validate().unwrap_err().contains("置信度"));
    }

    #[test]
    fn rejects_image_boxes_outside_normalized_range() {
        let mut draft = image_draft(ImportReviewStatus::Confirmed);
        draft.courses[0].review.as_mut().unwrap().source_box = Some(NormalizedImageBox {
            x: 0.9,
            y: 0.1,
            width: 0.2,
            height: 0.2,
        });
        assert!(draft.validate().unwrap_err().contains("归一化范围"));
    }

    #[test]
    fn rejects_unknown_field_names_and_statuses() {
        let mut value = serde_json::to_value(image_draft(ImportReviewStatus::Confirmed)).unwrap();
        value["courses"][0]["review"]["fields"][0]["field"] = json!("unknownField");
        assert!(serde_json::from_value::<ImportDraft>(value).is_err());

        let mut value = serde_json::to_value(image_draft(ImportReviewStatus::Confirmed)).unwrap();
        value["courses"][0]["review"]["fields"][0]["status"] = json!("maybe");
        assert!(serde_json::from_value::<ImportDraft>(value).is_err());
    }

    #[test]
    fn unresolved_review_and_required_missing_block() {
        let review = image_draft(ImportReviewStatus::Review);
        assert!(review.issues().iter().any(|issue| {
            issue.severity == ImportIssueSeverity::Review
                && issue.field == Some(ImportFieldKey::Name)
        }));
        assert!(review.validate().is_err());

        let missing = image_draft(ImportReviewStatus::Missing);
        assert!(missing
            .issues()
            .iter()
            .any(|issue| issue.code == "review.field.requiredMissing"));
        assert!(missing.validate().is_err());
    }

    #[test]
    fn confirmed_edit_passes_final_validation() {
        let mut draft = image_draft(ImportReviewStatus::Review);
        let evidence = &mut draft.courses[0].review.as_mut().unwrap().fields[0];
        evidence.status = ImportReviewStatus::Confirmed;
        evidence.reason = None;
        draft.courses[0].name = "程序设计基础".into();
        assert!(draft.validate().is_ok());
    }

    #[test]
    fn formal_conversion_uses_final_values_only() {
        let mut draft = image_draft(ImportReviewStatus::Confirmed);
        draft.courses[0].name = "最终课程名".into();
        draft.courses[0].teacher = Some("最终老师".into());
        draft.courses[0].review.as_mut().unwrap().fields[0].raw_text =
            Some("旧识别文本".into());
        let schedule = preview_import_schedule(
            &draft.courses,
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
        .unwrap();
        assert_eq!(schedule.courses[0].name, "最终课程名");
        assert_eq!(schedule.courses[0].teacher, "最终老师");
    }

    #[test]
    fn conflicts_are_non_blocking_warnings() {
        let mut draft = excel_draft();
        let mut second = draft.courses[0].clone();
        second.name = "第二门课".into();
        draft.courses.push(second);
        assert!(draft.issues().iter().any(|issue| {
            issue.code == "course.time.conflict"
                && issue.severity == ImportIssueSeverity::Warning
        }));
        assert!(draft.validate().is_ok());
    }
}
