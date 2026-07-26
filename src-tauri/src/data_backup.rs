use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::{
    app_settings::{self, AppSettings},
    excel_import::types::SectionTime,
    schedule_catalog::CatalogSchedule,
    schedule_store::{self, Course, Schedule},
};

const BACKUP_FORMAT: &str = "desktop-course-widget-backup";
const BACKUP_SCHEMA_VERSION: u8 = 1;
const CATALOG_SCHEMA_VERSION: u8 = 1;
const SETTINGS_SCHEMA_VERSION: u8 = 1;
const MAX_BACKUP_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SCHEDULES: usize = 30;
const MAX_LESSONS: usize = 24;
const MAX_TEXT: usize = 160;
const CATALOG_DIR: &str = "schedules";
const INDEX_FILE: &str = "index.json";
const SETTINGS_FILE: &str = "settings.json";
const LEGACY_SCHEDULE_FILE: &str = "schedule.json";
const SNAPSHOT_DIR: &str = "recovery-snapshots";
const TARGET_NAMES: [&str; 3] = [CATALOG_DIR, SETTINGS_FILE, LEGACY_SCHEDULE_FILE];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BackupBundle {
    format: String,
    schema_version: u8,
    app_version: String,
    created_at: u64,
    active_schedule_id: String,
    schedules: Vec<CatalogSchedule>,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CatalogIndexFile {
    schema_version: u8,
    active_schedule_id: String,
    schedule_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupExportResult {
    file_name: String,
    schedule_count: usize,
    course_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    path: String,
    file_name: String,
    created_at: u64,
    app_version: String,
    schedule_count: usize,
    course_count: usize,
    active_schedule_name: String,
    lesson_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreResult {
    schedule_count: usize,
    course_count: usize,
    active_schedule_name: String,
    safety_snapshot: String,
}

#[tauri::command]
pub async fn export_backup(app: AppHandle) -> Result<Option<BackupExportResult>, String> {
    let bundle = current_bundle(&app)?;
    let suggested_name = format!(
        "桌面课表备份-{}.json",
        chrono::Local::now().format("%Y-%m-%d")
    );
    let selected = app
        .dialog()
        .file()
        .set_title("导出桌面课表备份")
        .set_file_name(suggested_name)
        .add_filter("桌面课表备份", &["json"])
        .blocking_save_file();

    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut path = selected
        .into_path()
        .map_err(|_| "无法读取备份保存路径".to_owned())?;
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        path.set_extension("json");
    }

    write_json_atomic(&path, &bundle)?;
    Ok(Some(BackupExportResult {
        file_name: file_name(&path),
        schedule_count: bundle.schedules.len(),
        course_count: course_count(&bundle.schedules),
    }))
}

#[tauri::command]
pub async fn choose_backup_for_restore(app: AppHandle) -> Result<Option<BackupPreview>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("选择桌面课表备份")
        .add_filter("桌面课表备份", &["json"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "无法读取所选备份路径".to_owned())?;
    let bundle = read_and_validate_backup(&path)?;
    Ok(Some(preview_for(&path, &bundle)?))
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String) -> Result<BackupRestoreResult, String> {
    let source = PathBuf::from(path);
    let bundle = read_and_validate_backup(&source)?;
    let data_dir = data_directory(&app)?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let stamp = now_millis()?;
    let stage_root = data_dir.join(format!(".restore-stage-{stamp}"));
    let old_root = data_dir.join(format!(".restore-old-{stamp}"));
    remove_any(&stage_root)?;
    remove_any(&old_root)?;

    stage_bundle(&stage_root, &bundle)?;
    let snapshot = create_safety_snapshot(&data_dir, stamp)?;
    if let Err(error) = commit_staged_data(&data_dir, &stage_root, &old_root, None) {
        let _ = remove_any(&stage_root);
        let _ = remove_any(&old_root);
        return Err(format!("恢复失败，原数据已保留：{error}"));
    }
    cleanup_snapshots(&data_dir, 5);

    app.emit("schedule:updated", ())
        .map_err(|error| error.to_string())?;
    app.emit("settings:data-restored", ())
        .map_err(|error| error.to_string())?;

    let active = active_schedule(&bundle)?;
    Ok(BackupRestoreResult {
        schedule_count: bundle.schedules.len(),
        course_count: course_count(&bundle.schedules),
        active_schedule_name: active.name.clone(),
        safety_snapshot: snapshot.to_string_lossy().into_owned(),
    })
}

fn current_bundle(app: &AppHandle) -> Result<BackupBundle, String> {
    let catalog_dir = data_directory(app)?.join(CATALOG_DIR);
    let index: CatalogIndexFile = read_json(&catalog_dir.join(INDEX_FILE))
        .map_err(|error| format!("无法读取课表目录：{error}"))?;
    validate_index(&index)?;
    let schedules = index
        .schedule_ids
        .iter()
        .map(|id| read_json::<CatalogSchedule>(&catalog_dir.join(format!("{id}.json"))))
        .collect::<Result<Vec<_>, _>>()?;
    let settings = app_settings::read_app_settings(app)?;
    validate_and_normalize_bundle(BackupBundle {
        format: BACKUP_FORMAT.into(),
        schema_version: BACKUP_SCHEMA_VERSION,
        app_version: app.package_info().version.to_string(),
        created_at: now_millis()?,
        active_schedule_id: index.active_schedule_id,
        schedules,
        settings,
    })
}

fn read_and_validate_backup(path: &Path) -> Result<BackupBundle, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取备份文件：{error}"))?;
    if metadata.len() > MAX_BACKUP_BYTES {
        return Err("备份文件过大，无法安全恢复".into());
    }
    let bytes = fs::read(path).map_err(|error| format!("无法读取备份文件：{error}"))?;
    let bundle: BackupBundle =
        serde_json::from_slice(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes))
            .map_err(|error| format!("备份文件格式错误：{error}"))?;
    validate_and_normalize_bundle(bundle)
}

fn validate_and_normalize_bundle(mut bundle: BackupBundle) -> Result<BackupBundle, String> {
    if bundle.format != BACKUP_FORMAT {
        return Err("所选文件不是桌面课表备份".into());
    }
    if bundle.schema_version != BACKUP_SCHEMA_VERSION {
        return Err(format!("备份版本 {} 暂不受支持", bundle.schema_version));
    }
    if bundle.schedules.is_empty() || bundle.schedules.len() > MAX_SCHEDULES {
        return Err(format!("备份必须包含 1～{MAX_SCHEDULES} 份课表"));
    }

    let mut schedule_ids = HashSet::new();
    for schedule in &mut bundle.schedules {
        normalize_catalog_schedule(schedule)?;
        if !schedule_ids.insert(schedule.id.clone()) {
            return Err(format!("备份中存在重复课表标识：{}", schedule.id));
        }
    }
    if !schedule_ids.contains(&bundle.active_schedule_id) {
        return Err("备份中的当前课表记录无效".into());
    }
    normalize_settings(&mut bundle.settings)?;
    Ok(bundle)
}

fn normalize_catalog_schedule(schedule: &mut CatalogSchedule) -> Result<(), String> {
    if schedule.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(format!("课表“{}”的文件版本不受支持", schedule.name));
    }
    if !valid_id(&schedule.id) {
        return Err(format!("课表“{}”的标识无效", schedule.name));
    }
    schedule.name = schedule.name.trim().chars().take(80).collect();
    if schedule.name.is_empty() {
        return Err("备份中存在未命名课表".into());
    }
    if schedule.courses.is_empty() {
        return Err(format!("课表“{}”没有课程", schedule.name));
    }

    for (index, course) in schedule.courses.iter_mut().enumerate() {
        course.id = course.id.trim().to_owned();
        if course.id.is_empty() {
            return Err(format!(
                "课表“{}”的第 {} 项课程标识为空",
                schedule.name,
                index + 1
            ));
        }
        if course.teacher.chars().count() > MAX_TEXT {
            return Err(format!("课表“{}”中教师名称过长", schedule.name));
        }
        if !valid_color(&course.color) {
            return Err(format!("课表“{}”中存在无效课程颜色", schedule.name));
        }
        course.color = course.color.to_ascii_uppercase();
    }

    let legacy = legacy_schedule(schedule);
    let bytes = serde_json::to_vec(&legacy).map_err(|error| error.to_string())?;
    let validation = schedule_store::validate_schedule(&bytes);
    let normalized = validation.normalized_schedule.ok_or_else(|| {
        format!(
            "课表“{}”校验失败：{}",
            schedule.name,
            validation.errors.join("；")
        )
    })?;
    if normalized.courses.len() != schedule.courses.len() {
        return Err(format!("课表“{}”课程数量校验失败", schedule.name));
    }
    schedule.semester_start = normalized.semester_start;
    schedule.semester_end = normalized.semester_end;
    for (catalog, normalized) in schedule.courses.iter_mut().zip(normalized.courses) {
        catalog.name = normalized.name;
        catalog.teacher = normalized.teacher;
        catalog.weekday = normalized.weekday;
        catalog.start = normalized.start;
        catalog.end = normalized.end;
        catalog.location = normalized.location;
        catalog.weeks = normalized.weeks;
        catalog.parity = normalized.parity;
    }
    Ok(())
}

fn normalize_settings(settings: &mut AppSettings) -> Result<(), String> {
    if settings.schema_version != SETTINGS_SCHEMA_VERSION {
        return Err("备份中的设置版本不受支持".into());
    }
    settings.lesson_times.sort_by_key(|item| item.section);
    if settings.lesson_times.is_empty() || settings.lesson_times.len() > MAX_LESSONS {
        return Err(format!("备份作息必须包含 1～{MAX_LESSONS} 节"));
    }
    for (index, item) in settings.lesson_times.iter().enumerate() {
        let section = (index + 1) as u8;
        if item.section != section {
            return Err(format!("备份作息缺少第 {section} 节"));
        }
        let start = time_to_minutes(&item.start)
            .ok_or_else(|| format!("备份中第 {section} 节开始时间无效"))?;
        let end = time_to_minutes(&item.end)
            .ok_or_else(|| format!("备份中第 {section} 节结束时间无效"))?;
        if end <= start {
            return Err(format!("备份中第 {section} 节结束时间必须晚于开始时间"));
        }
    }
    Ok(())
}

fn preview_for(path: &Path, bundle: &BackupBundle) -> Result<BackupPreview, String> {
    let active = active_schedule(bundle)?;
    Ok(BackupPreview {
        path: path.to_string_lossy().into_owned(),
        file_name: file_name(path),
        created_at: bundle.created_at,
        app_version: bundle.app_version.clone(),
        schedule_count: bundle.schedules.len(),
        course_count: course_count(&bundle.schedules),
        active_schedule_name: active.name.clone(),
        lesson_count: bundle.settings.lesson_times.len(),
    })
}

fn active_schedule(bundle: &BackupBundle) -> Result<&CatalogSchedule, String> {
    bundle
        .schedules
        .iter()
        .find(|schedule| schedule.id == bundle.active_schedule_id)
        .ok_or_else(|| "备份中的当前课表记录无效".into())
}

fn course_count(schedules: &[CatalogSchedule]) -> usize {
    schedules
        .iter()
        .map(|schedule| {
            schedule
                .courses
                .iter()
                .map(|course| course.id.as_str())
                .collect::<HashSet<_>>()
                .len()
        })
        .sum()
}

fn stage_bundle(stage_root: &Path, bundle: &BackupBundle) -> Result<(), String> {
    fs::create_dir_all(stage_root.join(CATALOG_DIR)).map_err(|error| error.to_string())?;
    let index = CatalogIndexFile {
        schema_version: CATALOG_SCHEMA_VERSION,
        active_schedule_id: bundle.active_schedule_id.clone(),
        schedule_ids: bundle
            .schedules
            .iter()
            .map(|schedule| schedule.id.clone())
            .collect(),
    };
    write_json_atomic(&stage_root.join(CATALOG_DIR).join(INDEX_FILE), &index)?;
    for schedule in &bundle.schedules {
        write_json_atomic(
            &stage_root
                .join(CATALOG_DIR)
                .join(format!("{}.json", schedule.id)),
            schedule,
        )?;
    }
    write_json_atomic(&stage_root.join(SETTINGS_FILE), &bundle.settings)?;
    write_json_atomic(
        &stage_root.join(LEGACY_SCHEDULE_FILE),
        &legacy_schedule(active_schedule(bundle)?),
    )?;

    let staged_index: CatalogIndexFile = read_json(&stage_root.join(CATALOG_DIR).join(INDEX_FILE))?;
    validate_index(&staged_index)?;
    let staged_settings: AppSettings = read_json(&stage_root.join(SETTINGS_FILE))?;
    let mut staged_settings = staged_settings;
    normalize_settings(&mut staged_settings)?;
    let staged_legacy =
        fs::read(stage_root.join(LEGACY_SCHEDULE_FILE)).map_err(|error| error.to_string())?;
    if !schedule_store::validate_schedule(&staged_legacy).valid {
        return Err("恢复暂存课表校验失败".into());
    }
    Ok(())
}

fn create_safety_snapshot(data_dir: &Path, stamp: u64) -> Result<PathBuf, String> {
    let snapshot = data_dir.join(SNAPSHOT_DIR).join(format!("restore-{stamp}"));
    fs::create_dir_all(&snapshot).map_err(|error| error.to_string())?;
    for name in TARGET_NAMES {
        let source = data_dir.join(name);
        if source.exists() {
            copy_any(&source, &snapshot.join(name))?;
        }
    }
    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "createdAt": stamp,
        "reason": "before-restore"
    });
    write_json_atomic(&snapshot.join("snapshot.json"), &manifest)?;
    Ok(snapshot)
}

fn commit_staged_data(
    data_dir: &Path,
    stage_root: &Path,
    old_root: &Path,
    fail_before_install: Option<usize>,
) -> Result<(), String> {
    for name in TARGET_NAMES {
        if !stage_root.join(name).exists() {
            return Err(format!("暂存数据缺少 {name}"));
        }
    }
    fs::create_dir_all(old_root).map_err(|error| error.to_string())?;

    let mut moved_old = Vec::new();
    for name in TARGET_NAMES {
        let destination = data_dir.join(name);
        if !destination.exists() {
            continue;
        }
        let old = old_root.join(name);
        if let Err(error) = fs::rename(&destination, &old) {
            rollback_old_targets(data_dir, old_root, &moved_old);
            return Err(format!("无法暂存现有 {name}：{error}"));
        }
        moved_old.push(name);
    }

    let mut installed = Vec::new();
    for (index, name) in TARGET_NAMES.into_iter().enumerate() {
        if fail_before_install == Some(index) {
            rollback_install(data_dir, old_root, &installed, &moved_old);
            return Err("模拟恢复提交失败".into());
        }
        let staged = stage_root.join(name);
        let destination = data_dir.join(name);
        if let Err(error) = fs::rename(&staged, &destination) {
            rollback_install(data_dir, old_root, &installed, &moved_old);
            return Err(format!("无法安装恢复后的 {name}：{error}"));
        }
        installed.push(name);
    }

    remove_any(old_root)?;
    remove_any(stage_root)?;
    Ok(())
}

fn rollback_old_targets(data_dir: &Path, old_root: &Path, moved_old: &[&str]) {
    for name in moved_old.iter().rev() {
        let old = old_root.join(name);
        let destination = data_dir.join(name);
        let _ = fs::rename(old, destination);
    }
}

fn rollback_install(data_dir: &Path, old_root: &Path, installed: &[&str], moved_old: &[&str]) {
    for name in installed.iter().rev() {
        let _ = remove_any(&data_dir.join(name));
    }
    rollback_old_targets(data_dir, old_root, moved_old);
}

fn cleanup_snapshots(data_dir: &Path, keep: usize) {
    let root = data_dir.join(SNAPSHOT_DIR);
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    let remove_count = entries.len().saturating_sub(keep);
    for entry in entries.into_iter().take(remove_count) {
        if let Err(error) = remove_any(&entry.path()) {
            eprintln!("[backup] snapshot cleanup failed: {error}");
        }
    }
}

fn validate_index(index: &CatalogIndexFile) -> Result<(), String> {
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
    if !index
        .schedule_ids
        .iter()
        .any(|id| id == &index.active_schedule_id)
    {
        return Err("当前课表记录无效".into());
    }
    if index.schedule_ids.iter().any(|id| !valid_id(id)) {
        return Err("课表目录包含无效标识".into());
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

fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes))
        .map_err(|error| format!("文件格式错误：{error}"))
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
        let backup = path.with_extension("json.replace-old");
        remove_any(&backup)?;
        fs::rename(path, &backup).map_err(|error| error.to_string())?;
        if let Err(error) = fs::rename(&temporary, path) {
            let _ = fs::rename(&backup, path);
            return Err(error.to_string());
        }
        remove_any(&backup)?;
    } else {
        fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn copy_any(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_any(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else {
        let parent = destination.parent().ok_or("备份目录不可用")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        fs::copy(source, destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn remove_any(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn valid_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
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

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("桌面课表备份.json")
        .to_owned()
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
    use crate::schedule_catalog::CatalogCourse;

    fn sample_bundle() -> BackupBundle {
        BackupBundle {
            format: BACKUP_FORMAT.into(),
            schema_version: BACKUP_SCHEMA_VERSION,
            app_version: "0.4.0".into(),
            created_at: 1,
            active_schedule_id: "main".into(),
            schedules: vec![CatalogSchedule {
                schema_version: 1,
                id: "main".into(),
                name: "秋季课表".into(),
                semester_start: "2026-09-07".into(),
                semester_end: Some("2027-01-10".into()),
                courses: vec![CatalogCourse {
                    id: "course-1".into(),
                    name: "通信原理".into(),
                    color: "#CFE1FF".into(),
                    teacher: "老师".into(),
                    weekday: 1,
                    start: "08:00".into(),
                    end: "09:40".into(),
                    location: "教学楼".into(),
                    weeks: vec![1, 2, 3],
                    parity: "all".into(),
                }],
                created_at: 1,
                updated_at: 1,
            }],
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
    fn validates_round_trip_bundle() {
        let source = sample_bundle();
        let bytes = serde_json::to_vec(&source).unwrap();
        let parsed: BackupBundle = serde_json::from_slice(&bytes).unwrap();
        let normalized = validate_and_normalize_bundle(parsed).unwrap();
        assert_eq!(normalized.active_schedule_id, "main");
        assert_eq!(course_count(&normalized.schedules), 1);
    }

    #[test]
    fn rejects_wrong_format_duplicate_ids_and_missing_active_schedule() {
        let mut wrong_format = sample_bundle();
        wrong_format.format = "other".into();
        assert!(validate_and_normalize_bundle(wrong_format).is_err());

        let mut duplicate = sample_bundle();
        duplicate.schedules.push(duplicate.schedules[0].clone());
        assert!(validate_and_normalize_bundle(duplicate).is_err());

        let mut missing_active = sample_bundle();
        missing_active.active_schedule_id = "missing".into();
        assert!(validate_and_normalize_bundle(missing_active).is_err());
    }

    #[test]
    fn rejects_invalid_settings_without_touching_data() {
        let mut bundle = sample_bundle();
        bundle.settings.lesson_times[0].end = "07:59".into();
        assert!(validate_and_normalize_bundle(bundle).is_err());
    }

    #[test]
    fn transaction_rolls_back_after_partial_install() {
        let root = std::env::temp_dir().join(format!(
            "desktop-course-widget-restore-test-{}",
            now_millis().unwrap()
        ));
        let stage = root.join("stage");
        let old = root.join("old");
        fs::create_dir_all(root.join(CATALOG_DIR)).unwrap();
        fs::write(root.join(CATALOG_DIR).join("old.txt"), "old").unwrap();
        fs::write(root.join(SETTINGS_FILE), "old-settings").unwrap();
        fs::write(root.join(LEGACY_SCHEDULE_FILE), "old-schedule").unwrap();

        fs::create_dir_all(stage.join(CATALOG_DIR)).unwrap();
        fs::write(stage.join(CATALOG_DIR).join("new.txt"), "new").unwrap();
        fs::write(stage.join(SETTINGS_FILE), "new-settings").unwrap();
        fs::write(stage.join(LEGACY_SCHEDULE_FILE), "new-schedule").unwrap();

        assert!(commit_staged_data(&root, &stage, &old, Some(1)).is_err());
        assert_eq!(
            fs::read_to_string(root.join(CATALOG_DIR).join("old.txt")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(root.join(SETTINGS_FILE)).unwrap(),
            "old-settings"
        );
        assert_eq!(
            fs::read_to_string(root.join(LEGACY_SCHEDULE_FILE)).unwrap(),
            "old-schedule"
        );
        let _ = fs::remove_dir_all(root);
    }
}
