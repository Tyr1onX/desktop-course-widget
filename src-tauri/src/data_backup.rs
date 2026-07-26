use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Manager, Wry};
use tauri_plugin_dialog::DialogExt;

use crate::{
    app_settings::AppSettings,
    schedule_catalog::{CatalogCourse, CatalogSchedule},
    schedule_store::{self, Course, Schedule},
};

const BACKUP_SCHEMA_VERSION: u8 = 1;
const CATALOG_SCHEMA_VERSION: u8 = 1;
const SETTINGS_SCHEMA_VERSION: u8 = 1;
const MAX_SCHEDULES: usize = 30;
const MAX_LESSONS: usize = 24;
const MAX_BACKUP_BYTES: u64 = 10 * 1024 * 1024;
const BACKUPS_DIR: &str = "backups";
const CATALOG_DIR: &str = "schedules";
const INDEX_FILE: &str = "index.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BackupBundle {
    schema_version: u8,
    created_at: u64,
    app_version: String,
    catalog: BackupCatalog,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BackupCatalog {
    active_schedule_id: String,
    schedules: Vec<CatalogSchedule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredCatalogIndex {
    schema_version: u8,
    active_schedule_id: String,
    schedule_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupPreview {
    created_at: u64,
    app_version: String,
    schedule_count: usize,
    course_count: usize,
    active_schedule_name: String,
    lesson_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSelection {
    file_name: String,
    preview: BackupPreview,
    payload: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupExportResult {
    file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    schedule_count: usize,
    course_count: usize,
    active_schedule_name: String,
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("data-backup")
        .invoke_handler(tauri::generate_handler![
            export_backup,
            choose_backup,
            restore_backup,
        ])
        .build()
}

#[tauri::command]
fn export_backup(app: AppHandle) -> Result<Option<BackupExportResult>, String> {
    let bundle = collect_bundle(&app)?;
    let suggested = format!("桌面课表备份-{}.json", compact_date(bundle.created_at));
    let selected = app
        .dialog()
        .file()
        .add_filter("桌面课表备份", &["json"])
        .set_file_name(suggested)
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = ensure_json_extension(
        selected
            .into_path()
            .map_err(|_| "无法读取备份保存路径".to_owned())?,
    );
    write_json_atomic(&path, &bundle)?;
    Ok(Some(BackupExportResult {
        file_name: display_file_name(&path),
    }))
}

#[tauri::command]
fn choose_backup(app: AppHandle) -> Result<Option<BackupSelection>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("桌面课表备份", &["json"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "无法读取所选备份路径".to_owned())?;
    let bytes = read_limited(&path)?;
    let bundle: BackupBundle = serde_json::from_slice(&bytes)
        .map_err(|error| format!("备份文件格式错误：{error}"))?;
    validate_bundle(&bundle)?;
    let preview = preview_bundle(&bundle)?;
    let payload = serde_json::to_string(&bundle).map_err(|error| error.to_string())?;
    Ok(Some(BackupSelection {
        file_name: display_file_name(&path),
        preview,
        payload,
    }))
}

#[tauri::command]
fn restore_backup(app: AppHandle, payload: String) -> Result<RestoreResult, String> {
    if payload.len() as u64 > MAX_BACKUP_BYTES {
        return Err("备份内容过大".into());
    }
    let bundle: BackupBundle = serde_json::from_str(&payload)
        .map_err(|error| format!("备份内容格式错误：{error}"))?;
    validate_bundle(&bundle)?;
    let preview = preview_bundle(&bundle)?;
    restore_bundle(&app, &bundle)?;
    app.emit("schedule:updated", ())
        .map_err(|error| error.to_string())?;
    app.emit("settings:updated", ())
        .map_err(|error| error.to_string())?;
    app.emit("onboarding:completed", ())
        .map_err(|error| error.to_string())?;
    Ok(RestoreResult {
        schedule_count: preview.schedule_count,
        course_count: preview.course_count,
        active_schedule_name: preview.active_schedule_name,
    })
}

fn collect_bundle(app: &AppHandle) -> Result<BackupBundle, String> {
    let root = data_root(app)?;
    let index: StoredCatalogIndex = read_json(&root.join(CATALOG_DIR).join(INDEX_FILE))?;
    validate_index(&index)?;
    let schedules = index
        .schedule_ids
        .iter()
        .map(|id| read_json::<CatalogSchedule>(&schedule_path(&root, id)?))
        .collect::<Result<Vec<_>, _>>()?;
    let bundle = BackupBundle {
        schema_version: BACKUP_SCHEMA_VERSION,
        created_at: now_millis()?,
        app_version: app.package_info().version.to_string(),
        catalog: BackupCatalog {
            active_schedule_id: index.active_schedule_id,
            schedules,
        },
        settings: crate::app_settings::read_app_settings(app)?,
    };
    validate_bundle(&bundle)?;
    Ok(bundle)
}

fn preview_bundle(bundle: &BackupBundle) -> Result<BackupPreview, String> {
    let active = bundle
        .catalog
        .schedules
        .iter()
        .find(|schedule| schedule.id == bundle.catalog.active_schedule_id)
        .ok_or("备份中的当前课表无效")?;
    let course_count = bundle
        .catalog
        .schedules
        .iter()
        .map(unique_course_count)
        .sum();
    Ok(BackupPreview {
        created_at: bundle.created_at,
        app_version: bundle.app_version.clone(),
        schedule_count: bundle.catalog.schedules.len(),
        course_count,
        active_schedule_name: active.name.clone(),
        lesson_count: bundle.settings.lesson_times.len(),
    })
}

fn validate_bundle(bundle: &BackupBundle) -> Result<(), String> {
    if bundle.schema_version != BACKUP_SCHEMA_VERSION {
        return Err("备份版本不受支持".into());
    }
    if bundle.created_at == 0 {
        return Err("备份创建时间无效".into());
    }
    if bundle.catalog.schedules.is_empty() || bundle.catalog.schedules.len() > MAX_SCHEDULES {
        return Err(format!("备份必须包含 1～{MAX_SCHEDULES} 份课表"));
    }
    validate_settings(&bundle.settings)?;

    let mut ids = HashSet::new();
    for schedule in &bundle.catalog.schedules {
        if !ids.insert(schedule.id.clone()) {
            return Err(format!("备份包含重复课表标识：{}", schedule.id));
        }
        validate_catalog_schedule(schedule)?;
    }
    if !ids.contains(&bundle.catalog.active_schedule_id) {
        return Err("备份中的当前课表不存在".into());
    }
    Ok(())
}

fn validate_index(index: &StoredCatalogIndex) -> Result<(), String> {
    if index.schema_version != CATALOG_SCHEMA_VERSION {
        return Err("课表目录版本不受支持".into());
    }
    if index.schedule_ids.is_empty() || index.schedule_ids.len() > MAX_SCHEDULES {
        return Err("课表目录数量无效".into());
    }
    let unique = index.schedule_ids.iter().collect::<HashSet<_>>();
    if unique.len() != index.schedule_ids.len() {
        return Err("课表目录包含重复标识".into());
    }
    if !index.schedule_ids.contains(&index.active_schedule_id) {
        return Err("当前课表记录无效".into());
    }
    Ok(())
}

fn validate_catalog_schedule(schedule: &CatalogSchedule) -> Result<(), String> {
    if schedule.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(format!("课表“{}”的文件版本不受支持", schedule.name));
    }
    validate_identifier(&schedule.id, "课表标识")?;
    if schedule.name.trim().is_empty() || schedule.name.chars().count() > 80 {
        return Err("课表名称必须是 1～80 个字符".into());
    }
    let mut course_ids = HashSet::new();
    for course in &schedule.courses {
        validate_course_identifier(&course.id)?;
        course_ids.insert(course.id.as_str());
    }
    if course_ids.is_empty() {
        return Err(format!("课表“{}”没有课程", schedule.name));
    }
    let bytes = serde_json::to_vec(&legacy_schedule(schedule)).map_err(|error| error.to_string())?;
    let validation = schedule_store::validate_schedule(&bytes);
    if !validation.valid {
        return Err(format!(
            "课表“{}”校验失败：{}",
            schedule.name,
            validation.errors.join("；")
        ));
    }
    Ok(())
}

fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if settings.schema_version != SETTINGS_SCHEMA_VERSION {
        return Err("设置文件版本不受支持".into());
    }
    if settings.lesson_times.is_empty() || settings.lesson_times.len() > MAX_LESSONS {
        return Err(format!("作息时间必须包含 1～{MAX_LESSONS} 节"));
    }
    for (index, item) in settings.lesson_times.iter().enumerate() {
        let expected = (index + 1) as u8;
        if item.section != expected {
            return Err(format!("作息时间缺少第 {expected} 节"));
        }
        let start = time_to_minutes(&item.start)
            .ok_or_else(|| format!("第 {expected} 节开始时间格式无效"))?;
        let end = time_to_minutes(&item.end)
            .ok_or_else(|| format!("第 {expected} 节结束时间格式无效"))?;
        if end <= start {
            return Err(format!("第 {expected} 节结束时间必须晚于开始时间"));
        }
    }
    Ok(())
}

fn restore_bundle(app: &AppHandle, bundle: &BackupBundle) -> Result<(), String> {
    let root = data_root(app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let stamp = now_millis()?;
    let snapshot = create_safety_snapshot(&root, stamp)?;
    let staging = root.join(format!(".restore-staging-{stamp}"));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }

    let apply_result: Result<(), String> = (|| {
        write_staging_bundle(&staging, bundle)?;
        validate_staging_bundle(&staging, bundle)?;
        commit_staging_bundle(&root, &staging)?;
        Ok(())
    })();

    if let Err(error) = apply_result {
        let rollback = restore_snapshot(&root, &snapshot);
        let _ = fs::remove_dir_all(&staging);
        return match rollback {
            Ok(()) => Err(format!("恢复失败，已还原原数据：{error}")),
            Err(rollback_error) => Err(format!(
                "恢复失败，且自动回滚未完成：{error}；回滚错误：{rollback_error}"
            )),
        };
    }

    let _ = fs::remove_dir_all(&staging);
    cleanup_restore_snapshots(&root)?;
    Ok(())
}

fn write_staging_bundle(staging: &Path, bundle: &BackupBundle) -> Result<(), String> {
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;
    let catalog_dir = staging.join(CATALOG_DIR);
    fs::create_dir_all(&catalog_dir).map_err(|error| error.to_string())?;
    write_json_atomic(&staging.join("settings.json"), &bundle.settings)?;

    let active = bundle
        .catalog
        .schedules
        .iter()
        .find(|schedule| schedule.id == bundle.catalog.active_schedule_id)
        .ok_or("备份中的当前课表不存在")?;
    write_json_atomic(&staging.join("schedule.json"), &legacy_schedule(active))?;

    let index = StoredCatalogIndex {
        schema_version: CATALOG_SCHEMA_VERSION,
        active_schedule_id: bundle.catalog.active_schedule_id.clone(),
        schedule_ids: bundle
            .catalog
            .schedules
            .iter()
            .map(|schedule| schedule.id.clone())
            .collect(),
    };
    write_json_atomic(&catalog_dir.join(INDEX_FILE), &index)?;
    for schedule in &bundle.catalog.schedules {
        write_json_atomic(&catalog_dir.join(format!("{}.json", schedule.id)), schedule)?;
    }
    Ok(())
}

fn validate_staging_bundle(staging: &Path, expected: &BackupBundle) -> Result<(), String> {
    let settings: AppSettings = read_json(&staging.join("settings.json"))?;
    let index: StoredCatalogIndex = read_json(&staging.join(CATALOG_DIR).join(INDEX_FILE))?;
    validate_index(&index)?;
    let schedules = index
        .schedule_ids
        .iter()
        .map(|id| read_json::<CatalogSchedule>(&staging.join(CATALOG_DIR).join(format!("{id}.json"))))
        .collect::<Result<Vec<_>, _>>()?;
    let staged = BackupBundle {
        schema_version: BACKUP_SCHEMA_VERSION,
        created_at: expected.created_at,
        app_version: expected.app_version.clone(),
        catalog: BackupCatalog {
            active_schedule_id: index.active_schedule_id,
            schedules,
        },
        settings,
    };
    validate_bundle(&staged)?;
    if &staged != expected {
        return Err("暂存数据与备份内容不一致".into());
    }
    let active_legacy: Schedule = read_json(&staging.join("schedule.json"))?;
    let expected_active = expected
        .catalog
        .schedules
        .iter()
        .find(|schedule| schedule.id == expected.catalog.active_schedule_id)
        .ok_or("备份中的当前课表不存在")?;
    let active_bytes = serde_json::to_vec(&active_legacy).map_err(|error| error.to_string())?;
    let expected_bytes = serde_json::to_vec(&legacy_schedule(expected_active))
        .map_err(|error| error.to_string())?;
    if active_bytes != expected_bytes {
        return Err("桌面组件课表暂存校验失败".into());
    }
    Ok(())
}

fn commit_staging_bundle(root: &Path, staging: &Path) -> Result<(), String> {
    replace_file(&staging.join("settings.json"), &root.join("settings.json"))?;
    replace_file(&staging.join("schedule.json"), &root.join("schedule.json"))?;
    let destination_catalog = root.join(CATALOG_DIR);
    if destination_catalog.exists() {
        fs::remove_dir_all(&destination_catalog).map_err(|error| error.to_string())?;
    }
    fs::rename(staging.join(CATALOG_DIR), destination_catalog).map_err(|error| error.to_string())
}

fn create_safety_snapshot(root: &Path, stamp: u64) -> Result<PathBuf, String> {
    let snapshot = root.join(BACKUPS_DIR).join(format!("restore-{stamp}"));
    fs::create_dir_all(&snapshot).map_err(|error| error.to_string())?;
    copy_if_exists(&root.join("settings.json"), &snapshot.join("settings.json"))?;
    copy_if_exists(&root.join("schedule.json"), &snapshot.join("schedule.json"))?;
    copy_directory_if_exists(&root.join(CATALOG_DIR), &snapshot.join(CATALOG_DIR))?;
    Ok(snapshot)
}

fn restore_snapshot(root: &Path, snapshot: &Path) -> Result<(), String> {
    let settings = snapshot.join("settings.json");
    if settings.exists() {
        fs::copy(settings, root.join("settings.json")).map_err(|error| error.to_string())?;
    }
    let schedule = snapshot.join("schedule.json");
    if schedule.exists() {
        fs::copy(schedule, root.join("schedule.json")).map_err(|error| error.to_string())?;
    }
    let snapshot_catalog = snapshot.join(CATALOG_DIR);
    if snapshot_catalog.exists() {
        let destination = root.join(CATALOG_DIR);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
        }
        copy_directory(&snapshot_catalog, &destination)?;
    }
    Ok(())
}

fn cleanup_restore_snapshots(root: &Path) -> Result<(), String> {
    let backups = root.join(BACKUPS_DIR);
    if !backups.exists() {
        return Ok(());
    }
    let mut snapshots = fs::read_dir(&backups)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("restore-")
                && entry.path().is_dir()
        })
        .collect::<Vec<_>>();
    snapshots.sort_by_key(|entry| entry.file_name());
    for entry in snapshots.into_iter().rev().skip(5) {
        fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn copy_if_exists(source: &Path, destination: &Path) -> Result<(), String> {
    if source.exists() {
        fs::copy(source, destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn copy_directory_if_exists(source: &Path, destination: &Path) -> Result<(), String> {
    if source.exists() {
        copy_directory(source, destination)?;
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(source_path, destination_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| error.to_string())?;
    }
    fs::rename(source, destination).map_err(|error| error.to_string())
}

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())
}

fn schedule_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    validate_identifier(id, "课表标识")?;
    Ok(root.join(CATALOG_DIR).join(format!("{id}.json")))
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 120
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err(format!("{label}无效"));
    }
    Ok(())
}

fn validate_course_identifier(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > 160 {
        return Err("课程标识无效".into());
    }
    Ok(())
}

fn legacy_schedule(schedule: &CatalogSchedule) -> Schedule {
    Schedule {
        schema_version: 1,
        semester_start: schedule.semester_start.clone(),
        semester_end: schedule.semester_end.clone(),
        courses: schedule
            .courses
            .iter()
            .map(legacy_course)
            .collect(),
    }
}

fn legacy_course(course: &CatalogCourse) -> Course {
    Course {
        name: course.name.clone(),
        teacher: course.teacher.clone(),
        weekday: course.weekday,
        start: course.start.clone(),
        end: course.end.clone(),
        location: course.location.clone(),
        weeks: course.weeks.clone(),
        parity: course.parity.clone(),
    }
}

fn unique_course_count(schedule: &CatalogSchedule) -> usize {
    schedule
        .courses
        .iter()
        .map(|course| course.id.as_str())
        .collect::<HashSet<_>>()
        .len()
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_BACKUP_BYTES {
        return Err("备份文件过大".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = read_limited(path)?;
    serde_json::from_slice(&bytes).map_err(|error| format!("文件格式错误：{error}"))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or("备份目录不可用")?;
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

fn ensure_json_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().is_none() {
        path.set_extension("json");
    }
    path
}

fn display_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("桌面课表备份.json")
        .to_owned()
}

fn compact_date(timestamp: u64) -> String {
    let seconds = timestamp / 1000;
    format!("{seconds}")
}

fn time_to_minutes(value: &str) -> Option<u16> {
    let (hours, minutes) = value.split_once(':')?;
    if hours.len() != 2 || minutes.len() != 2 {
        return None;
    }
    let hours: u16 = hours.parse().ok()?;
    let minutes: u16 = minutes.parse().ok()?;
    (hours < 24 && minutes < 60).then_some(hours * 60 + minutes)
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
    use crate::excel_import::types::SectionTime;

    fn sample_schedule(id: &str, name: &str) -> CatalogSchedule {
        CatalogSchedule {
            schema_version: 1,
            id: id.into(),
            name: name.into(),
            semester_start: "2026-09-07".into(),
            semester_end: Some("2026-12-27".into()),
            courses: vec![CatalogCourse {
                id: "course-1".into(),
                name: "通信原理".into(),
                color: "#CFE1FF".into(),
                teacher: "教师".into(),
                weekday: 1,
                start: "08:00".into(),
                end: "09:40".into(),
                location: "101".into(),
                weeks: vec![1, 2],
                parity: "all".into(),
            }],
            created_at: 1,
            updated_at: 1,
        }
    }

    fn sample_bundle() -> BackupBundle {
        BackupBundle {
            schema_version: 1,
            created_at: 1,
            app_version: "0.4.0".into(),
            catalog: BackupCatalog {
                active_schedule_id: "schedule-1".into(),
                schedules: vec![sample_schedule("schedule-1", "秋季学期")],
            },
            settings: AppSettings {
                schema_version: 1,
                onboarding_completed: true,
                lesson_times: vec![SectionTime {
                    section: 1,
                    start: "08:00".into(),
                    end: "08:45".into(),
                }],
                equal_duration: false,
            },
        }
    }

    #[test]
    fn accepts_valid_backup_and_builds_preview() {
        let bundle = sample_bundle();
        validate_bundle(&bundle).unwrap();
        let preview = preview_bundle(&bundle).unwrap();
        assert_eq!(preview.schedule_count, 1);
        assert_eq!(preview.course_count, 1);
        assert_eq!(preview.active_schedule_name, "秋季学期");
    }

    #[test]
    fn rejects_unknown_schema_duplicate_ids_and_missing_active_schedule() {
        let mut bundle = sample_bundle();
        bundle.schema_version = 2;
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = sample_bundle();
        bundle
            .catalog
            .schedules
            .push(sample_schedule("schedule-1", "重复课表"));
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = sample_bundle();
        bundle.catalog.active_schedule_id = "missing".into();
        assert!(validate_bundle(&bundle).is_err());
    }

    #[test]
    fn rejects_invalid_lesson_times_and_invalid_schedule_data() {
        let mut bundle = sample_bundle();
        bundle.settings.lesson_times[0].end = "07:00".into();
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = sample_bundle();
        bundle.catalog.schedules[0].courses[0].weeks.clear();
        assert!(validate_bundle(&bundle).is_err());
    }
}
