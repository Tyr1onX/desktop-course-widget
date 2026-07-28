use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    app_settings,
    excel_import::{self, types::SectionTime},
    import_draft::{ImportCourse, ImportDraft},
    schedule_apply,
    schedule_store::{self, Course, Schedule},
};

const CATALOG_SCHEMA_VERSION: u8 = 1;
const CATALOG_DIR: &str = "schedules";
const INDEX_FILE: &str = "index.json";
const MAX_SCHEDULES: usize = 30;
const PALETTE: [&str; 10] = [
    "#CFE1FF", "#D8EBCF", "#F8D8D2", "#E5D9F7", "#F9E3B7", "#CFE9E8", "#F2D6E6", "#D9E1F2",
    "#E4E7C9", "#F4DCC5",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCourse {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub teacher: String,
    pub weekday: u8,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub location: String,
    pub weeks: Vec<u8>,
    pub parity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSchedule {
    #[serde(default = "catalog_schema_version")]
    pub schema_version: u8,
    pub id: String,
    pub name: String,
    pub semester_start: String,
    #[serde(default)]
    pub semester_end: Option<String>,
    pub courses: Vec<CatalogCourse>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CatalogIndex {
    #[serde(default = "catalog_schema_version")]
    schema_version: u8,
    active_schedule_id: String,
    schedule_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSummary {
    id: String,
    name: String,
    semester_start: String,
    semester_end: Option<String>,
    course_count: usize,
    active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduleFromImportRequest {
    name: String,
    first_week_monday: String,
    draft: ImportDraft,
    times: Vec<SectionTime>,
    equal_duration: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCourseRequest {
    course_id: Option<String>,
    name: String,
    color: String,
    slots: Vec<SaveCourseSlot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCourseSlot {
    weekday: u8,
    start: String,
    end: String,
    weeks: Vec<u8>,
    parity: String,
    location: String,
    teacher: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScheduleRequest {
    schedule_id: String,
    name: String,
    semester_start: String,
    semester_end: Option<String>,
}

fn catalog_schema_version() -> u8 {
    CATALOG_SCHEMA_VERSION
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("schedule-catalog")
        .invoke_handler(tauri::generate_handler![
            list_schedules,
            get_active_schedule,
            get_schedule,
            update_schedule,
            activate_schedule,
            delete_schedule,
            create_schedule_from_import,
            save_course,
            delete_course,
            read_autostart,
            set_autostart,
            open_data_location,
        ])
        .build()
}

#[tauri::command]
fn list_schedules(app: AppHandle) -> Result<Vec<ScheduleSummary>, String> {
    let index = ensure_catalog(&app)?;
    index
        .schedule_ids
        .iter()
        .map(|id| {
            let schedule = read_catalog_schedule(&app, id)?;
            Ok(ScheduleSummary {
                id: schedule.id,
                name: schedule.name,
                semester_start: schedule.semester_start,
                semester_end: schedule.semester_end,
                course_count: schedule
                    .courses
                    .iter()
                    .map(|course| course.id.as_str())
                    .collect::<std::collections::HashSet<_>>()
                    .len(),
                active: id == &index.active_schedule_id,
            })
        })
        .collect()
}

#[tauri::command]
fn get_active_schedule(app: AppHandle) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    read_catalog_schedule(&app, &index.active_schedule_id)
}

#[tauri::command]
fn get_schedule(app: AppHandle, schedule_id: String) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    if !index.schedule_ids.iter().any(|id| id == &schedule_id) {
        return Err("找不到要编辑的课表".into());
    }
    read_catalog_schedule(&app, &schedule_id)
}

#[tauri::command]
fn update_schedule(
    app: AppHandle,
    request: UpdateScheduleRequest,
) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    if !index
        .schedule_ids
        .iter()
        .any(|id| id == &request.schedule_id)
    {
        return Err("找不到要编辑的课表".into());
    }
    if request.name.trim().is_empty() {
        return Err("课表名称不能为空".into());
    }

    let mut schedule = read_catalog_schedule(&app, &request.schedule_id)?;
    schedule.name = request.name;
    schedule.semester_start = request.semester_start;
    schedule.semester_end = request.semester_end;
    schedule.updated_at = now_millis()?;
    normalize_catalog_schedule(&mut schedule)?;
    write_catalog_schedule(&app, &schedule)?;

    if index.active_schedule_id == schedule.id {
        apply_active_schedule(&app, &schedule)?;
        emit_schedule_updated(&app)?;
    }
    Ok(schedule)
}

#[tauri::command]
fn activate_schedule(app: AppHandle, schedule_id: String) -> Result<CatalogSchedule, String> {
    let mut index = ensure_catalog(&app)?;
    if !index.schedule_ids.iter().any(|id| id == &schedule_id) {
        return Err("找不到要启用的课表".into());
    }
    let schedule = read_catalog_schedule(&app, &schedule_id)?;
    apply_active_schedule(&app, &schedule)?;
    index.active_schedule_id = schedule_id;
    write_index(&app, &index)?;
    emit_schedule_updated(&app)?;
    Ok(schedule)
}

#[tauri::command]
fn delete_schedule(app: AppHandle, schedule_id: String) -> Result<CatalogSchedule, String> {
    let mut index = ensure_catalog(&app)?;
    if index.schedule_ids.len() <= 1 {
        return Err("至少需要保留一份课表".into());
    }
    let Some(position) = index.schedule_ids.iter().position(|id| id == &schedule_id) else {
        return Err("找不到要删除的课表".into());
    };

    index.schedule_ids.remove(position);
    let deleting_active = index.active_schedule_id == schedule_id;
    if deleting_active {
        let next_position = position.min(index.schedule_ids.len() - 1);
        index.active_schedule_id = index.schedule_ids[next_position].clone();
    }

    let path = schedule_path(&app, &schedule_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    write_index(&app, &index)?;

    let active = read_catalog_schedule(&app, &index.active_schedule_id)?;
    if deleting_active {
        apply_active_schedule(&app, &active)?;
        emit_schedule_updated(&app)?;
    }
    Ok(active)
}

#[tauri::command]
fn create_schedule_from_import(
    app: AppHandle,
    request: CreateScheduleFromImportRequest,
) -> Result<CatalogSchedule, String> {
    let mut index = ensure_catalog(&app)?;
    if index.schedule_ids.len() >= MAX_SCHEDULES {
        return Err(format!("最多保留 {MAX_SCHEDULES} 份课表"));
    }
    request.draft.validate()?;

    let source_entries = request.draft.courses;
    let converted = excel_import::converter::preview_import_schedule(
        &source_entries,
        &request.first_week_monday,
        &request.times,
    )?;
    let timestamp = now_millis()?;
    let id = unique_id(&app, "schedule", timestamp)?;
    let courses = imported_catalog_courses(converted.courses, &source_entries);
    let mut schedule = CatalogSchedule {
        schema_version: CATALOG_SCHEMA_VERSION,
        id: id.clone(),
        name: normalize_schedule_name(&request.name),
        semester_start: converted.semester_start,
        semester_end: converted.semester_end,
        courses,
        created_at: timestamp,
        updated_at: timestamp,
    };
    normalize_catalog_schedule(&mut schedule)?;
    write_catalog_schedule(&app, &schedule)?;
    apply_active_schedule(&app, &schedule)?;

    index.schedule_ids.push(id.clone());
    index.active_schedule_id = id;
    write_index(&app, &index)?;
    app_settings::save_lesson_times(&app, request.times, request.equal_duration, true)?;
    emit_schedule_updated(&app)?;
    app.emit("onboarding:completed", ())
        .map_err(|error| error.to_string())?;
    Ok(schedule)
}

#[tauri::command]
fn save_course(app: AppHandle, request: SaveCourseRequest) -> Result<CatalogSchedule, String> {
    let mut index = ensure_catalog(&app)?;
    let mut schedule = read_catalog_schedule(&app, &index.active_schedule_id)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err("课程名称不能为空".into());
    }
    if request.slots.is_empty() {
        return Err("至少需要一个上课时间段".into());
    }

    let timestamp = now_millis()?;
    let course_id = request
        .course_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("course-{timestamp}"));
    let insert_at = schedule
        .courses
        .iter()
        .position(|course| course.id == course_id)
        .unwrap_or(schedule.courses.len());
    schedule.courses.retain(|course| course.id != course_id);

    let color = normalize_color(&request.color, schedule.courses.len());
    let replacements = request.slots.into_iter().map(|slot| CatalogCourse {
        id: course_id.clone(),
        name: name.to_owned(),
        color: color.clone(),
        teacher: slot.teacher,
        weekday: slot.weekday,
        start: slot.start,
        end: slot.end,
        location: slot.location,
        weeks: slot.weeks,
        parity: slot.parity,
    });
    schedule.courses.splice(insert_at..insert_at, replacements);
    schedule.updated_at = timestamp;
    normalize_catalog_schedule(&mut schedule)?;
    write_catalog_schedule(&app, &schedule)?;
    apply_active_schedule(&app, &schedule)?;
    index.active_schedule_id = schedule.id.clone();
    write_index(&app, &index)?;
    emit_schedule_updated(&app)?;
    Ok(schedule)
}

#[tauri::command]
fn delete_course(app: AppHandle, course_id: String) -> Result<CatalogSchedule, String> {
    let index = ensure_catalog(&app)?;
    let mut schedule = read_catalog_schedule(&app, &index.active_schedule_id)?;
    if !schedule.courses.iter().any(|course| course.id == course_id) {
        return Err("找不到要删除的课程".into());
    }
    let remaining = schedule
        .courses
        .iter()
        .filter(|course| course.id != course_id)
        .count();
    if remaining == 0 {
        return Err("当前版本暂不删除课表中的最后一门课程；可以删除整份课表".into());
    }

    schedule.courses.retain(|course| course.id != course_id);
    schedule.updated_at = now_millis()?;
    normalize_catalog_schedule(&mut schedule)?;
    write_catalog_schedule(&app, &schedule)?;
    apply_active_schedule(&app, &schedule)?;
    emit_schedule_updated(&app)?;
    Ok(schedule)
}

#[tauri::command]
fn read_autostart(app: AppHandle) -> Result<bool, String> {
    if cfg!(debug_assertions) {
        return Ok(false);
    }
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if cfg!(debug_assertions) {
        return Err("请在 Release 版本测试开机启动".into());
    }
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|error| error.to_string())?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|error| error.to_string())?;
    }
    read_autostart(app)
}

#[tauri::command]
fn open_data_location(app: AppHandle) -> Result<(), String> {
    let directory = catalog_directory(&app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    std::process::Command::new("explorer.exe")
        .arg(directory)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_catalog(app: &AppHandle) -> Result<CatalogIndex, String> {
    let directory = catalog_directory(app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = index_path(app)?;
    if path.exists() {
        let index: CatalogIndex = read_json(&path)?;
        validate_index(&index)?;
        return Ok(index);
    }

    let legacy = schedule_store::read_user_schedule(app)?;
    let timestamp = now_millis()?;
    let id = "default".to_owned();
    let mut schedule = catalog_from_legacy(id.clone(), "当前课表".into(), legacy, timestamp);
    normalize_catalog_schedule(&mut schedule)?;
    write_catalog_schedule(app, &schedule)?;
    let index = CatalogIndex {
        schema_version: CATALOG_SCHEMA_VERSION,
        active_schedule_id: id.clone(),
        schedule_ids: vec![id],
    };
    write_index(app, &index)?;
    Ok(index)
}

fn validate_index(index: &CatalogIndex) -> Result<(), String> {
    if index.schema_version != CATALOG_SCHEMA_VERSION {
        return Err("课表目录版本不受支持".into());
    }
    if index.schedule_ids.is_empty() {
        return Err("课表目录中没有可用课表".into());
    }
    if !index
        .schedule_ids
        .iter()
        .any(|id| id == &index.active_schedule_id)
    {
        return Err("当前课表记录无效".into());
    }
    Ok(())
}

fn catalog_from_legacy(
    id: String,
    name: String,
    schedule: Schedule,
    timestamp: u64,
) -> CatalogSchedule {
    let mut course_ids: HashMap<String, (String, String)> = HashMap::new();
    let mut next_group = 0usize;
    let courses = schedule
        .courses
        .into_iter()
        .map(|course| {
            let key = course.name.trim().to_owned();
            let (course_id, color) = course_ids
                .entry(key)
                .or_insert_with(|| {
                    let value = (
                        format!("legacy-course-{}", next_group + 1),
                        PALETTE[next_group % PALETTE.len()].to_owned(),
                    );
                    next_group += 1;
                    value
                })
                .clone();
            CatalogCourse {
                id: course_id,
                name: course.name,
                color,
                teacher: course.teacher,
                weekday: course.weekday,
                start: course.start,
                end: course.end,
                location: course.location,
                weeks: course.weeks,
                parity: course.parity,
            }
        })
        .collect();

    CatalogSchedule {
        schema_version: CATALOG_SCHEMA_VERSION,
        id,
        name,
        semester_start: schedule.semester_start,
        semester_end: schedule.semester_end,
        courses,
        created_at: timestamp,
        updated_at: timestamp,
    }
}

fn imported_catalog_courses(courses: Vec<Course>, entries: &[ImportCourse]) -> Vec<CatalogCourse> {
    let mut groups: HashMap<String, (String, String)> = HashMap::new();
    let mut next_group = 0usize;
    courses
        .into_iter()
        .zip(entries)
        .map(|(course, entry)| {
            let key = entry
                .code
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&entry.name)
                .trim()
                .to_owned();
            let (id, color) = groups
                .entry(key)
                .or_insert_with(|| {
                    let value = (
                        format!("course-{}", next_group + 1),
                        PALETTE[next_group % PALETTE.len()].to_owned(),
                    );
                    next_group += 1;
                    value
                })
                .clone();
            CatalogCourse {
                id,
                name: course.name,
                color,
                teacher: course.teacher,
                weekday: course.weekday,
                start: course.start,
                end: course.end,
                location: course.location,
                weeks: course.weeks,
                parity: course.parity,
            }
        })
        .collect()
}

fn normalize_catalog_schedule(schedule: &mut CatalogSchedule) -> Result<(), String> {
    if schedule.schema_version != CATALOG_SCHEMA_VERSION {
        return Err("课表文件版本不受支持".into());
    }
    schedule.name = normalize_schedule_name(&schedule.name);
    if schedule.id.trim().is_empty() {
        return Err("课表标识不能为空".into());
    }
    for (index, course) in schedule.courses.iter_mut().enumerate() {
        course.id = course.id.trim().to_owned();
        if course.id.is_empty() {
            course.id = format!("course-{}", index + 1);
        }
        course.color = normalize_color(&course.color, index);
    }

    let validation = schedule_store::validate_schedule(&serialize_legacy(schedule)?);
    let normalized = validation
        .normalized_schedule
        .ok_or_else(|| validation.errors.join("；"))?;
    if normalized.courses.len() != schedule.courses.len() {
        return Err("课表课程数量校验失败".into());
    }
    for (catalog_course, legacy_course) in schedule.courses.iter_mut().zip(normalized.courses) {
        catalog_course.name = legacy_course.name;
        catalog_course.teacher = legacy_course.teacher;
        catalog_course.weekday = legacy_course.weekday;
        catalog_course.start = legacy_course.start;
        catalog_course.end = legacy_course.end;
        catalog_course.location = legacy_course.location;
        catalog_course.weeks = legacy_course.weeks;
        catalog_course.parity = legacy_course.parity;
    }
    schedule.semester_start = normalized.semester_start;
    schedule.semester_end = normalized.semester_end;
    Ok(())
}

fn normalize_schedule_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "新课表".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn normalize_color(value: &str, index: usize) -> String {
    let valid = value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit());
    if valid {
        value.to_ascii_uppercase()
    } else {
        PALETTE[index % PALETTE.len()].to_owned()
    }
}

fn serialize_legacy(schedule: &CatalogSchedule) -> Result<Vec<u8>, String> {
    let legacy = legacy_schedule(schedule);
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&legacy).map_err(|error| error.to_string())?
    )
    .into_bytes())
}

fn legacy_schedule(schedule: &CatalogSchedule) -> Schedule {
    Schedule {
        schema_version: 1,
        semester_start: schedule.semester_start.clone(),
        semester_end: schedule.semester_end.clone(),
        courses: schedule
            .courses
            .iter()
            .map(|course| Course {
                name: course.name.clone(),
                teacher: course.teacher.clone(),
                weekday: course.weekday,
                start: course.start.clone(),
                end: course.end.clone(),
                location: course.location.clone(),
                weeks: course.weeks.clone(),
                parity: course.parity.clone(),
            })
            .collect(),
    }
}

fn apply_active_schedule(app: &AppHandle, schedule: &CatalogSchedule) -> Result<(), String> {
    schedule_apply::apply_schedule(app, &legacy_schedule(schedule))?;
    Ok(())
}

fn emit_schedule_updated(app: &AppHandle) -> Result<(), String> {
    app.emit("schedule:updated", ())
        .map_err(|error| error.to_string())
}

fn catalog_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join(CATALOG_DIR))
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(catalog_directory(app)?.join(INDEX_FILE))
}

fn schedule_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || !id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("课表标识无效".into());
    }
    Ok(catalog_directory(app)?.join(format!("{id}.json")))
}

fn read_catalog_schedule(app: &AppHandle, id: &str) -> Result<CatalogSchedule, String> {
    let path = schedule_path(app, id)?;
    let mut schedule: CatalogSchedule = read_json(&path)?;
    normalize_catalog_schedule(&mut schedule)?;
    Ok(schedule)
}

fn write_catalog_schedule(app: &AppHandle, schedule: &CatalogSchedule) -> Result<(), String> {
    write_json_atomic(&schedule_path(app, &schedule.id)?, schedule)
}

fn write_index(app: &AppHandle, index: &CatalogIndex) -> Result<(), String> {
    validate_index(index)?;
    write_json_atomic(&index_path(app)?, index)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| format!("文件格式错误：{error}"))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("数据目录不可用")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let text = format!(
        "{}\n",
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?
    );
    fs::write(&temporary, text).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn unique_id(app: &AppHandle, prefix: &str, seed: u64) -> Result<String, String> {
    for offset in 0..100u64 {
        let id = format!("{prefix}-{}", seed + offset);
        if !schedule_path(app, &id)?.exists() {
            return Ok(id);
        }
    }
    Err("无法生成新的课表标识".into())
}

fn now_millis() -> Result<u64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?;
    u64::try_from(duration.as_millis()).map_err(|_| "系统时间超出支持范围".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_legacy() -> Schedule {
        Schedule {
            schema_version: 1,
            semester_start: "2026-09-07".into(),
            semester_end: Some("2026-09-20".into()),
            courses: vec![
                Course {
                    name: "通信原理".into(),
                    teacher: "A".into(),
                    weekday: 1,
                    start: "08:00".into(),
                    end: "09:40".into(),
                    location: "101".into(),
                    weeks: vec![1, 2],
                    parity: "all".into(),
                },
                Course {
                    name: "通信原理".into(),
                    teacher: "B".into(),
                    weekday: 3,
                    start: "10:00".into(),
                    end: "11:40".into(),
                    location: "202".into(),
                    weeks: vec![1, 2],
                    parity: "all".into(),
                },
            ],
        }
    }

    #[test]
    fn migration_groups_same_named_course_into_multiple_slots() {
        let catalog = catalog_from_legacy("default".into(), "当前课表".into(), sample_legacy(), 1);
        assert_eq!(catalog.courses.len(), 2);
        assert_eq!(catalog.courses[0].id, catalog.courses[1].id);
        assert_eq!(catalog.courses[0].color, catalog.courses[1].color);
    }

    #[test]
    fn invalid_color_falls_back_to_soft_palette() {
        assert_eq!(normalize_color("red", 0), PALETTE[0]);
        assert_eq!(normalize_color("#abcdef", 0), "#ABCDEF");
    }
}
