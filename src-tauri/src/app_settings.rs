use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::excel_import::types::SectionTime;

const SETTINGS_FILE: &str = "settings.json";
const MAX_LESSONS: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "schema_version")]
    pub schema_version: u8,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default = "default_lesson_times")]
    pub lesson_times: Vec<SectionTime>,
    #[serde(default)]
    pub equal_duration: bool,
}

fn schema_version() -> u8 {
    1
}

pub fn default_lesson_times() -> Vec<SectionTime> {
    [
        (1, "08:00", "08:45"),
        (2, "08:55", "09:40"),
        (3, "10:00", "10:45"),
        (4, "10:55", "11:40"),
        (5, "13:30", "14:15"),
        (6, "14:25", "15:10"),
        (7, "15:30", "16:15"),
        (8, "16:25", "17:10"),
        (9, "18:00", "18:45"),
        (10, "18:55", "19:40"),
    ]
    .into_iter()
    .map(|(section, start, end)| SectionTime {
        section,
        start: start.into(),
        end: end.into(),
    })
    .collect()
}

fn default_settings(onboarding_completed: bool) -> AppSettings {
    AppSettings {
        schema_version: schema_version(),
        onboarding_completed,
        lesson_times: default_lesson_times(),
        equal_duration: false,
    }
}

fn resolve_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join(SETTINGS_FILE))
}

pub fn ensure_app_settings(
    app: &AppHandle,
    migrated_onboarding_completed: bool,
) -> Result<AppSettings, String> {
    let path = resolve_settings_path(app)?;
    if path.exists() {
        return read_from_path(&path);
    }

    let settings = default_settings(migrated_onboarding_completed);
    write_atomic(&path, &settings)?;
    Ok(settings)
}

pub fn read_app_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = resolve_settings_path(app)?;
    if !path.exists() {
        return ensure_app_settings(app, false);
    }
    read_from_path(&path)
}

pub fn save_lesson_times(
    app: &AppHandle,
    lesson_times: Vec<SectionTime>,
    equal_duration: bool,
    complete_onboarding: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(app)?;
    settings.lesson_times = normalize_lesson_times(lesson_times)?;
    settings.equal_duration = equal_duration;
    if complete_onboarding {
        settings.onboarding_completed = true;
    }
    write_atomic(&resolve_settings_path(app)?, &settings)?;
    Ok(settings)
}

fn read_from_path(path: &PathBuf) -> Result<AppSettings, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let mut settings: AppSettings =
        serde_json::from_slice(&bytes).map_err(|error| format!("设置文件格式错误：{error}"))?;
    if settings.schema_version != schema_version() {
        return Err("设置文件版本不受支持".into());
    }
    settings.lesson_times = normalize_lesson_times(settings.lesson_times)?;
    Ok(settings)
}

fn write_atomic(path: &PathBuf, settings: &AppSettings) -> Result<(), String> {
    let parent = path.parent().ok_or("设置目录不可用")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?
    );
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    let check = read_from_path(&temporary)?;
    if &check != settings {
        let _ = fs::remove_file(&temporary);
        return Err("临时设置校验失败".into());
    }
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn normalize_lesson_times(mut lesson_times: Vec<SectionTime>) -> Result<Vec<SectionTime>, String> {
    lesson_times.sort_by_key(|item| item.section);
    if lesson_times.is_empty() || lesson_times.len() > MAX_LESSONS {
        return Err(format!("作息时间必须包含 1～{MAX_LESSONS} 节"));
    }

    for (index, item) in lesson_times.iter().enumerate() {
        let expected = (index + 1) as u8;
        if item.section != expected {
            return Err(format!("缺少第 {expected} 节作息时间"));
        }
        let start = time_to_minutes(&item.start)
            .ok_or_else(|| format!("第 {expected} 节开始时间格式无效"))?;
        let end = time_to_minutes(&item.end)
            .ok_or_else(|| format!("第 {expected} 节结束时间格式无效"))?;
        if end <= start {
            return Err(format!("第 {expected} 节结束时间必须晚于开始时间"));
        }
    }

    Ok(lesson_times)
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

#[allow(dead_code)]
fn invalid_backup_name() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("settings-invalid-{stamp}.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_dynamic_contiguous_lesson_times() {
        assert_eq!(normalize_lesson_times(default_lesson_times()).unwrap().len(), 10);
        assert_eq!(
            normalize_lesson_times(default_lesson_times().into_iter().take(6).collect())
                .unwrap()
                .len(),
            6
        );
    }

    #[test]
    fn rejects_empty_missing_or_reversed_lesson_times() {
        assert!(normalize_lesson_times(vec![]).is_err());

        let mut missing = default_lesson_times();
        missing.remove(4);
        assert!(normalize_lesson_times(missing).is_err());

        let mut reversed = default_lesson_times();
        reversed[0].end = "07:59".into();
        assert!(normalize_lesson_times(reversed).is_err());
    }
}
