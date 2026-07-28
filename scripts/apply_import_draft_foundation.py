from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"expected one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


Path("src/import-draft.ts").write_text(
    """export type ImportSource = 'excel' | 'image'\n\nexport type ImportCourse = {\n  code?: string | null\n  name: string\n  teacher?: string | null\n  weekday: number\n  startSection: number\n  endSection: number\n  weeks: number[]\n  parity: 'all' | 'odd' | 'even'\n  location?: string | null\n}\n\nexport type ImportDraftSummary = {\n  arrangements: number\n  highestWeek: number\n  locationCount: number\n}\n\nexport type ImportDraft = {\n  schemaVersion: number\n  source: ImportSource\n  sourceName: string\n  suggestedName: string\n  detectedTermText?: string | null\n  summary: ImportDraftSummary\n  warnings: string[]\n  courses: ImportCourse[]\n}\n""",
    encoding="utf-8",
)

Path("src-tauri/src/import_draft.rs").write_text(
    """use serde::{Deserialize, Serialize};\n\nuse crate::excel_import::types::{ParsedCourseEntry, ParsedWorkbook};\n\nconst IMPORT_DRAFT_SCHEMA_VERSION: u8 = 1;\n\n#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]\n#[serde(rename_all = \"lowercase\")]\npub enum ImportSource {\n    Excel,\n    Image,\n}\n\n#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]\n#[serde(rename_all = \"camelCase\")]\npub struct ImportCourse {\n    pub code: Option<String>,\n    pub name: String,\n    #[serde(default)]\n    pub teacher: Option<String>,\n    pub weekday: u8,\n    pub start_section: u8,\n    pub end_section: u8,\n    pub weeks: Vec<u8>,\n    pub parity: String,\n    pub location: Option<String>,\n}\n\nimpl From<ParsedCourseEntry> for ImportCourse {\n    fn from(entry: ParsedCourseEntry) -> Self {\n        Self {\n            code: entry.code,\n            name: entry.name,\n            teacher: None,\n            weekday: entry.weekday,\n            start_section: entry.start_section,\n            end_section: entry.end_section,\n            weeks: entry.weeks,\n            parity: entry.parity,\n            location: entry.location,\n        }\n    }\n}\n\n#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]\n#[serde(rename_all = \"camelCase\")]\npub struct ImportDraftSummary {\n    pub arrangements: usize,\n    pub highest_week: u8,\n    pub location_count: usize,\n}\n\n#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]\n#[serde(rename_all = \"camelCase\")]\npub struct ImportDraft {\n    pub schema_version: u8,\n    pub source: ImportSource,\n    pub source_name: String,\n    pub suggested_name: String,\n    pub detected_term_text: Option<String>,\n    pub summary: ImportDraftSummary,\n    pub warnings: Vec<String>,\n    pub courses: Vec<ImportCourse>,\n}\n\nimpl ImportDraft {\n    pub fn from_excel(source_name: String, parsed: ParsedWorkbook) -> Self {\n        let ParsedWorkbook {\n            detected_term_text,\n            scheduled_entries,\n            warnings,\n        } = parsed;\n        let courses = scheduled_entries\n            .into_iter()\n            .map(ImportCourse::from)\n            .collect::<Vec<_>>();\n        let suggested_name = detected_term_text\n            .as_deref()\n            .map(str::trim)\n            .filter(|value| !value.is_empty())\n            .map(ToOwned::to_owned)\n            .unwrap_or_else(|| source_stem(&source_name));\n        let summary = summarize(&courses);\n\n        Self {\n            schema_version: IMPORT_DRAFT_SCHEMA_VERSION,\n            source: ImportSource::Excel,\n            source_name,\n            suggested_name,\n            detected_term_text,\n            summary,\n            warnings,\n            courses,\n        }\n    }\n\n    pub fn validate(&self) -> Result<(), String> {\n        if self.schema_version != IMPORT_DRAFT_SCHEMA_VERSION {\n            return Err(\"导入草稿版本不受支持\".into());\n        }\n        if self.source_name.trim().is_empty() {\n            return Err(\"导入来源名称不能为空\".into());\n        }\n        if self.courses.is_empty() {\n            return Err(\"没有可创建的课程安排\".into());\n        }\n\n        for (index, course) in self.courses.iter().enumerate() {\n            let label = index + 1;\n            if course.name.trim().is_empty() {\n                return Err(format!(\"第 {label} 项课程名称不能为空\"));\n            }\n            if !(1..=7).contains(&course.weekday) {\n                return Err(format!(\"第 {label} 项课程的星期无效\"));\n            }\n            if course.start_section == 0 || course.end_section < course.start_section {\n                return Err(format!(\"第 {label} 项课程的节次范围无效\"));\n            }\n            if course.weeks.is_empty()\n                || course.weeks.iter().any(|week| !(1..=30).contains(week))\n            {\n                return Err(format!(\"第 {label} 项课程的教学周无效\"));\n            }\n            if !matches!(course.parity.as_str(), \"all\" | \"odd\" | \"even\") {\n                return Err(format!(\"第 {label} 项课程的单双周设置无效\"));\n            }\n        }\n        Ok(())\n    }\n}\n\nfn summarize(courses: &[ImportCourse]) -> ImportDraftSummary {\n    ImportDraftSummary {\n        arrangements: courses.len(),\n        highest_week: courses\n            .iter()\n            .flat_map(|course| course.weeks.iter().copied())\n            .max()\n            .unwrap_or(0),\n        location_count: courses\n            .iter()\n            .filter(|course| {\n                course\n                    .location\n                    .as_deref()\n                    .is_some_and(|location| !location.trim().is_empty())\n            })\n            .count(),\n    }\n}\n\nfn source_stem(source_name: &str) -> String {\n    let trimmed = source_name.trim();\n    if trimmed.to_ascii_lowercase().ends_with(\".xlsx\") {\n        trimmed[..trimmed.len() - 5].to_owned()\n    } else if trimmed.is_empty() {\n        \"新课表\".into()\n    } else {\n        trimmed.to_owned()\n    }\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    fn parsed_course() -> ParsedCourseEntry {\n        ParsedCourseEntry {\n            code: Some(\"CS101\".into()),\n            name: \"程序设计\".into(),\n            weekday: 2,\n            start_section: 1,\n            end_section: 2,\n            weeks: vec![1, 2, 3],\n            parity: \"all\".into(),\n            location: Some(\"A101\".into()),\n        }\n    }\n\n    #[test]\n    fn converts_excel_result_into_source_neutral_draft() {\n        let draft = ImportDraft::from_excel(\n            \"我的课表.xlsx\".into(),\n            ParsedWorkbook {\n                detected_term_text: None,\n                scheduled_entries: vec![parsed_course()],\n                warnings: vec![\"示例提示\".into()],\n            },\n        );\n\n        assert_eq!(draft.source, ImportSource::Excel);\n        assert_eq!(draft.suggested_name, \"我的课表\");\n        assert_eq!(draft.summary.arrangements, 1);\n        assert_eq!(draft.summary.highest_week, 3);\n        assert_eq!(draft.summary.location_count, 1);\n        assert_eq!(draft.courses[0].teacher, None);\n        assert!(draft.validate().is_ok());\n    }\n\n    #[test]\n    fn rejects_invalid_course_coordinates() {\n        let mut draft = ImportDraft::from_excel(\n            \"课表.xlsx\".into(),\n            ParsedWorkbook {\n                detected_term_text: None,\n                scheduled_entries: vec![parsed_course()],\n                warnings: vec![],\n            },\n        );\n        draft.courses[0].weekday = 8;\n        assert_eq!(draft.validate().unwrap_err(), \"第 1 项课程的星期无效\");\n    }\n}\n""",
    encoding="utf-8",
)

replace_once(
    "src/settings.ts",
    "import { getCurrentWindow } from '@tauri-apps/api/window'\nimport scheduleData from './data/schedule.json'",
    "import { getCurrentWindow } from '@tauri-apps/api/window'\nimport type { ImportDraft } from './import-draft'\nimport scheduleData from './data/schedule.json'",
)

replace_once(
    "src/settings.ts",
    """type ExcelCourse = {\n  code?: string | null\n  name: string\n  weekday: number\n  startSection: number\n  endSection: number\n  weeks: number[]\n  parity: string\n  location?: string | null\n}\n\ntype ExcelImportPreview = {\n  fileName: string\n  detectedTermText: string | null\n  arrangements: number\n  highestWeek: number\n  locationCount: number\n  warnings: string[]\n  courses: ExcelCourse[]\n}\n\n""",
    "",
)

replace_once(
    "src/settings.ts",
    "let importPreview: ExcelImportPreview | null = null",
    "let importDraft: ImportDraft | null = null",
)

replace_once(
    "src/settings.ts",
    """function importSurfaceMarkup(): string {\n  const preview = importPreview\n  return surfaceShell('导入新课表', `\n    <div class=\"surface-scroll simple-surface\">\n      <div class=\"surface-intro\">\n        <h3>从 Excel 创建独立课表</h3>\n        <p>每次导入都会新建一份课表并自动切换过去，已有课表不会被覆盖。</p>\n      </div>\n      <button class=\"import-picker\" type=\"button\" data-action=\"choose-excel\">\n        <strong>${escapeHtml(preview?.fileName ?? '选择一份 .xlsx 课表')}</strong>\n        <span>${desktopRuntime ? '文件只在本机解析，不会上传' : '浏览器预览中不会读取本机文件'}</span>\n      </button>\n      ${preview ? `\n        <div class=\"import-summary\">\n          <div><span>课程安排</span><strong>${preview.arrangements} 项</strong></div>\n          <div><span>最高教学周</span><strong>${preview.highestWeek} 周</strong></div>\n          <div><span>有效地点</span><strong>${preview.locationCount} 项</strong></div>\n        </div>\n        <label class=\"field field--full\"><span>课表名称</span><input id=\"import-name\" value=\"${escapeHtml(preview.detectedTermText ?? preview.fileName.replace(/\\.xlsx$/i, ''))}\" /></label>\n        <label class=\"field field--full\"><span>第一周星期一</span><input id=\"import-first-week\" type=\"date\" value=\"${schedule.semesterStart}\" /></label>\n        ${preview.warnings.length ? `<p class=\"warning-note\">解析器给出了 ${preview.warnings.length} 条提示，创建后可继续检查课程。</p>` : ''}\n      ` : ''}\n      <p class=\"surface-message\" role=\"status\">${escapeHtml(surfaceMessage)}</p>\n    </div>\n    <footer class=\"surface-actions surface-actions--end\">\n      <button class=\"primary-button\" type=\"button\" data-action=\"create-imported-schedule\"${preview ? '' : ' disabled'}>创建并启用课表</button>\n    </footer>\n  `)\n}\n""",
    """function importSurfaceMarkup(): string {\n  const draft = importDraft\n  return surfaceShell('导入新课表', `\n    <div class=\"surface-scroll simple-surface\">\n      <div class=\"surface-intro\">\n        <h3>从 Excel 创建独立课表</h3>\n        <p>每次导入都会新建一份课表并自动切换过去，已有课表不会被覆盖。</p>\n      </div>\n      <button class=\"import-picker\" type=\"button\" data-action=\"choose-excel\">\n        <strong>${escapeHtml(draft?.sourceName ?? '选择一份 .xlsx 课表')}</strong>\n        <span>${desktopRuntime ? '文件只在本机解析，不会上传' : '浏览器预览中不会读取本机文件'}</span>\n      </button>\n      ${draft ? `\n        <div class=\"import-summary\">\n          <div><span>课程安排</span><strong>${draft.summary.arrangements} 项</strong></div>\n          <div><span>最高教学周</span><strong>${draft.summary.highestWeek} 周</strong></div>\n          <div><span>有效地点</span><strong>${draft.summary.locationCount} 项</strong></div>\n        </div>\n        <label class=\"field field--full\"><span>课表名称</span><input id=\"import-name\" value=\"${escapeHtml(draft.suggestedName)}\" /></label>\n        <label class=\"field field--full\"><span>第一周星期一</span><input id=\"import-first-week\" type=\"date\" value=\"${schedule.semesterStart}\" /></label>\n        ${draft.warnings.length ? `<p class=\"warning-note\">解析器给出了 ${draft.warnings.length} 条提示，创建后可继续检查课程。</p>` : ''}\n      ` : ''}\n      <p class=\"surface-message\" role=\"status\">${escapeHtml(surfaceMessage)}</p>\n    </div>\n    <footer class=\"surface-actions surface-actions--end\">\n      <button class=\"primary-button\" type=\"button\" data-action=\"create-imported-schedule\"${draft ? '' : ' disabled'}>创建并启用课表</button>\n    </footer>\n  `)\n}\n""",
)

replace_once(
    "src/settings.ts",
    """    importPreview = await invoke<ExcelImportPreview | null>('choose_and_parse_excel')\n    surfaceMessage = importPreview ? '解析完成，请确认课表名称和第一周日期。' : '已取消选择。'""",
    """    importDraft = await invoke<ImportDraft | null>('choose_and_parse_excel')\n    surfaceMessage = importDraft ? '解析完成，请确认课表名称和第一周日期。' : '已取消选择。'""",
)

replace_once(
    "src/settings.ts",
    """async function createImportedSchedule(): Promise<void> {\n  if (!importPreview) return\n  const name = document.querySelector<HTMLInputElement>('#import-name')?.value.trim() ?? ''\n  const firstWeekMonday = document.querySelector<HTMLInputElement>('#import-first-week')?.value ?? ''\n  try {\n    if (!name) throw new Error('请填写课表名称')\n    if (!firstWeekMonday) throw new Error('请确认第一周星期一')\n    if (desktopRuntime) {\n      await invoke(plugin('create_schedule_from_import'), {\n        request: {\n          name,\n          firstWeekMonday,\n          courses: importPreview.courses,\n          times: settings.lessonTimes,\n          equalDuration: settings.equalDuration,\n        },\n      })\n      await reloadDesktopState()\n    }\n    importPreview = null\n    surface = null\n    currentWeek = initialWeek(schedule)\n    render()\n    showToast('新课表已创建并启用')\n  } catch (error) {\n    surfaceMessage = errorText(error)\n    render()\n  }\n}\n""",
    """async function createImportedSchedule(): Promise<void> {\n  if (!importDraft) return\n  const name = document.querySelector<HTMLInputElement>('#import-name')?.value.trim() ?? ''\n  const firstWeekMonday = document.querySelector<HTMLInputElement>('#import-first-week')?.value ?? ''\n  try {\n    if (!name) throw new Error('请填写课表名称')\n    if (!firstWeekMonday) throw new Error('请确认第一周星期一')\n    if (desktopRuntime) {\n      await invoke(plugin('create_schedule_from_import'), {\n        request: {\n          name,\n          firstWeekMonday,\n          draft: importDraft,\n          times: settings.lessonTimes,\n          equalDuration: settings.equalDuration,\n        },\n      })\n      await reloadDesktopState()\n    }\n    importDraft = null\n    surface = null\n    currentWeek = initialWeek(schedule)\n    render()\n    showToast('新课表已创建并启用')\n  } catch (error) {\n    surfaceMessage = errorText(error)\n    render()\n  }\n}\n""",
)

settings_text = Path("src/settings.ts").read_text(encoding="utf-8")
for obsolete in ("importPreview", "ExcelImportPreview", "ExcelCourse"):
    if obsolete in settings_text:
        raise RuntimeError(f"obsolete frontend import symbol remains: {obsolete}")

replace_once(
    "src-tauri/src/lib.rs",
    "pub mod excel_import;\nmod schedule_apply;",
    "pub mod excel_import;\nmod import_draft;\nmod schedule_apply;",
)

replace_once(
    "src-tauri/src/lib.rs",
    """#[derive(serde::Serialize)]\n#[serde(rename_all = \"camelCase\")]\nstruct ExcelImportPreview {\n    file_name: String,\n    detected_term_text: Option<String>,\n    arrangements: usize,\n    highest_week: u8,\n    location_count: usize,\n    warnings: Vec<String>,\n    courses: Vec<excel_import::types::ParsedCourseEntry>,\n}\n\n""",
    "",
)

replace_once(
    "src-tauri/src/lib.rs",
    """#[tauri::command]\nasync fn choose_and_parse_excel(app: AppHandle) -> Result<Option<ExcelImportPreview>, String> {\n    let selected = app\n        .dialog()\n        .file()\n        .add_filter(\"Excel 课表\", &[\"xlsx\"])\n        .blocking_pick_file();\n\n    let Some(selected) = selected else {\n        return Ok(None);\n    };\n\n    let path = selected\n        .into_path()\n        .map_err(|_| \"无法读取所选 Excel 文件路径\".to_owned())?;\n    let parsed = excel_import::workbook::parse_xlsx(&path)?;\n    let arrangements = parsed.scheduled_entries.len();\n    let highest_week = parsed\n        .scheduled_entries\n        .iter()\n        .flat_map(|entry| entry.weeks.iter())\n        .copied()\n        .max()\n        .unwrap_or(0);\n    let location_count = parsed\n        .scheduled_entries\n        .iter()\n        .filter(|entry| {\n            entry\n                .location\n                .as_deref()\n                .is_some_and(|location| !location.trim().is_empty())\n        })\n        .count();\n    let file_name = path\n        .file_name()\n        .and_then(|name| name.to_str())\n        .unwrap_or(\"已选择课表.xlsx\")\n        .to_owned();\n\n    Ok(Some(ExcelImportPreview {\n        file_name,\n        detected_term_text: parsed.detected_term_text,\n        arrangements,\n        highest_week,\n        location_count,\n        warnings: parsed.warnings,\n        courses: parsed.scheduled_entries,\n    }))\n}\n""",
    """#[tauri::command]\nasync fn choose_and_parse_excel(app: AppHandle) -> Result<Option<import_draft::ImportDraft>, String> {\n    let selected = app\n        .dialog()\n        .file()\n        .add_filter(\"Excel 课表\", &[\"xlsx\"])\n        .blocking_pick_file();\n\n    let Some(selected) = selected else {\n        return Ok(None);\n    };\n\n    let path = selected\n        .into_path()\n        .map_err(|_| \"无法读取所选 Excel 文件路径\".to_owned())?;\n    let parsed = excel_import::workbook::parse_xlsx(&path)?;\n    let file_name = path\n        .file_name()\n        .and_then(|name| name.to_str())\n        .unwrap_or(\"已选择课表.xlsx\")\n        .to_owned();\n    let draft = import_draft::ImportDraft::from_excel(file_name, parsed);\n    draft.validate()?;\n    Ok(Some(draft))\n}\n""",
)

replace_once(
    "src-tauri/src/excel_import/converter.rs",
    "use super::types::{ParsedWorkbook, SectionTime};\nuse crate::schedule_store::{Course, Schedule};",
    "use super::types::{ParsedWorkbook, SectionTime};\nuse crate::{\n    import_draft::{ImportCourse, ImportDraft},\n    schedule_store::{Course, Schedule},\n};",
)

replace_once(
    "src-tauri/src/excel_import/converter.rs",
    """pub fn preview_schedule(\n    parsed: &ParsedWorkbook,\n    first_week_monday: &str,\n    times: &[SectionTime],\n) -> Result<Schedule, String> {\n    let first_week_monday = NaiveDate::parse_from_str(first_week_monday, \"%Y-%m-%d\")\n        .map_err(|_| \"第一教学周日期格式必须为 YYYY-MM-DD\")?;\n    if first_week_monday.weekday().num_days_from_monday() != 0 {\n        return Err(\"第一教学周日期必须是星期一\".into());\n    }\n    let mut courses = Vec::new();\n    for entry in &parsed.scheduled_entries {\n        let start = times\n            .iter()\n            .find(|t| t.section == entry.start_section)\n            .ok_or(\"第N节没有配置作息时间\")?;\n        let end = times\n            .iter()\n            .find(|t| t.section == entry.end_section)\n            .ok_or(\"第N节没有配置作息时间\")?;\n        courses.push(Course {\n            name: entry.name.clone(),\n            teacher: String::new(),\n            weekday: entry.weekday,\n            start: start.start.clone(),\n            end: end.end.clone(),\n            location: entry.location.clone().unwrap_or_default(),\n            weeks: entry.weeks.clone(),\n            parity: entry.parity.clone(),\n        });\n    }\n    let maximum_week = parsed\n        .scheduled_entries\n        .iter()\n        .flat_map(|entry| entry.weeks.iter().copied())\n        .max()\n        .ok_or(\"没有可转换的已排课程\")?;\n    let semester_end = first_week_monday + Duration::days(i64::from(maximum_week) * 7 - 1);\n\n    Ok(Schedule {\n        schema_version: 1,\n        semester_start: first_week_monday.format(\"%Y-%m-%d\").to_string(),\n        semester_end: Some(semester_end.format(\"%Y-%m-%d\").to_string()),\n        courses,\n    })\n}\n""",
    """pub fn preview_schedule(\n    parsed: &ParsedWorkbook,\n    first_week_monday: &str,\n    times: &[SectionTime],\n) -> Result<Schedule, String> {\n    let draft = ImportDraft::from_excel(\"课表.xlsx\".into(), parsed.clone());\n    preview_import_schedule(&draft.courses, first_week_monday, times)\n}\n\npub fn preview_import_schedule(\n    entries: &[ImportCourse],\n    first_week_monday: &str,\n    times: &[SectionTime],\n) -> Result<Schedule, String> {\n    let first_week_monday = NaiveDate::parse_from_str(first_week_monday, \"%Y-%m-%d\")\n        .map_err(|_| \"第一教学周日期格式必须为 YYYY-MM-DD\")?;\n    if first_week_monday.weekday().num_days_from_monday() != 0 {\n        return Err(\"第一教学周日期必须是星期一\".into());\n    }\n    let mut courses = Vec::new();\n    for entry in entries {\n        let start = times\n            .iter()\n            .find(|time| time.section == entry.start_section)\n            .ok_or(\"第N节没有配置作息时间\")?;\n        let end = times\n            .iter()\n            .find(|time| time.section == entry.end_section)\n            .ok_or(\"第N节没有配置作息时间\")?;\n        courses.push(Course {\n            name: entry.name.clone(),\n            teacher: entry.teacher.clone().unwrap_or_default(),\n            weekday: entry.weekday,\n            start: start.start.clone(),\n            end: end.end.clone(),\n            location: entry.location.clone().unwrap_or_default(),\n            weeks: entry.weeks.clone(),\n            parity: entry.parity.clone(),\n        });\n    }\n    let maximum_week = entries\n        .iter()\n        .flat_map(|entry| entry.weeks.iter().copied())\n        .max()\n        .ok_or(\"没有可转换的已排课程\")?;\n    let semester_end = first_week_monday + Duration::days(i64::from(maximum_week) * 7 - 1);\n\n    Ok(Schedule {\n        schema_version: 1,\n        semester_start: first_week_monday.format(\"%Y-%m-%d\").to_string(),\n        semester_end: Some(semester_end.format(\"%Y-%m-%d\").to_string()),\n        courses,\n    })\n}\n""",
)

replace_once(
    "src-tauri/src/schedule_catalog.rs",
    """use crate::{\n    app_settings,\n    excel_import::{\n        self,\n        types::{ParsedCourseEntry, ParsedWorkbook, SectionTime},\n    },\n    schedule_apply,\n    schedule_store::{self, Course, Schedule},\n};""",
    """use crate::{\n    app_settings,\n    excel_import::{self, types::SectionTime},\n    import_draft::{ImportCourse, ImportDraft},\n    schedule_apply,\n    schedule_store::{self, Course, Schedule},\n};""",
)

replace_once(
    "src-tauri/src/schedule_catalog.rs",
    "    courses: Vec<ParsedCourseEntry>,",
    "    draft: ImportDraft,",
)

replace_once(
    "src-tauri/src/schedule_catalog.rs",
    """    if request.courses.is_empty() {\n        return Err(\"没有可创建的课程安排\".into());\n    }\n\n    let source_entries = request.courses;\n    let parsed = ParsedWorkbook {\n        detected_term_text: None,\n        scheduled_entries: source_entries.clone(),\n        warnings: vec![],\n    };\n    let converted = excel_import::converter::preview_schedule(\n        &parsed,\n        &request.first_week_monday,\n        &request.times,\n    )?;""",
    """    request.draft.validate()?;\n\n    let source_entries = request.draft.courses;\n    let converted = excel_import::converter::preview_import_schedule(\n        &source_entries,\n        &request.first_week_monday,\n        &request.times,\n    )?;""",
)

replace_once(
    "src-tauri/src/schedule_catalog.rs",
    "    entries: &[ParsedCourseEntry],",
    "    entries: &[ImportCourse],",
)

replace_once(
    "CHANGELOG.md",
    "## Unreleased\n\n",
    "## Unreleased\n\n- Added a source-neutral import draft shared by Excel import and future screenshot recognition.\n",
)
