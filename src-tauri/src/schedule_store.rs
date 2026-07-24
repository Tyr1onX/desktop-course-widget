use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_COURSES: usize = 500;
const MAX_TEXT: usize = 160;
const EXAMPLE_SCHEDULE: &str = include_str!("../../src/data/schedule.json");

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    #[serde(default = "schema_version")]
    pub schema_version: u8,
    pub semester_start: String,
    #[serde(default)]
    pub semester_end: Option<String>,
    pub courses: Vec<Course>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Course {
    pub name: String,
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

#[derive(Default, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_schedule: Option<Schedule>,
}

fn schema_version() -> u8 {
    1
}

pub fn resolve_schedule_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("schedule.json"))
}

pub fn ensure_schedule_storage(app: &AppHandle) -> Result<PathBuf, String> {
    let path = resolve_schedule_path(app)?;
    let parent = path.parent().ok_or("课表目录不可用")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if !path.exists() {
        let validation = validate_schedule(EXAMPLE_SCHEDULE.as_bytes());
        let schedule = validation
            .normalized_schedule
            .ok_or_else(|| validation.errors.join("；"))?;
        write_atomic(&path, &serialize(&schedule)?)?;
        // First-run migration preserves the bundled source bytes exactly.
        write_atomic(&path, EXAMPLE_SCHEDULE.as_bytes())?;
    }
    Ok(path)
}

pub fn read_user_schedule(app: &AppHandle) -> Result<Schedule, String> {
    let path = ensure_schedule_storage(app)?;
    let bytes = read_limited(&path)?;
    let validation = validate_schedule(&bytes);
    validation
        .normalized_schedule
        .ok_or_else(|| validation.errors.join("；"))
}

pub fn validate_schedule(bytes: &[u8]) -> ValidationResult {
    let mut result = ValidationResult::default();
    let text = match std::str::from_utf8(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes)) {
        Ok(text) => text,
        Err(_) => {
            result.errors.push("文件必须使用 UTF-8 编码".into());
            return result;
        }
    };
    let mut schedule: Schedule = match serde_json::from_str(text) {
        Ok(schedule) => schedule,
        Err(error) => {
            result.errors.push(format!("JSON 格式错误：{error}"));
            return result;
        }
    };
    if schedule.schema_version != 1 {
        result.errors.push("schemaVersion：当前仅支持 1".into());
    }
    if !valid_date(&schedule.semester_start) {
        result
            .errors
            .push("semesterStart：必须是有效 YYYY-MM-DD 日期".into());
    }
    if let Some(end) = &schedule.semester_end {
        if !valid_date(end) {
            result
                .errors
                .push("semesterEnd：必须是有效 YYYY-MM-DD 日期".into());
        } else if end < &schedule.semester_start {
            result
                .errors
                .push("semesterEnd：不得早于 semesterStart".into());
        }
    }
    if schedule.courses.is_empty() || schedule.courses.len() > MAX_COURSES {
        result
            .errors
            .push("courses：必须是 1 至 500 门课程的数组".into());
    }
    for (index, course) in schedule.courses.iter_mut().enumerate() {
        let p = format!("courses[{index}]");
        course.name = course.name.trim().to_owned();
        course.teacher = course.teacher.trim().to_owned();
        course.location = course.location.trim().to_owned();
        if course.name.is_empty() || course.name.chars().count() > MAX_TEXT {
            result
                .errors
                .push(format!("{p}.name：必须是 1 至 {MAX_TEXT} 字符的文本"));
        }
        if course.location.chars().count() > MAX_TEXT {
            result
                .errors
                .push(format!("{p}.location：长度不能超过 {MAX_TEXT}"));
        }
        if !(1..=7).contains(&course.weekday) {
            result
                .errors
                .push(format!("{p}.weekday：必须是 1～7 的整数"));
        }
        let start = valid_time(&course.start);
        let end = valid_time(&course.end);
        if start.is_none() {
            result.errors.push(format!("{p}.start：时间格式应为 HH:mm"));
        }
        if end.is_none() {
            result.errors.push(format!("{p}.end：时间格式应为 HH:mm"));
        }
        if let (Some(start), Some(end)) = (start, end) {
            if end <= start {
                result
                    .errors
                    .push(format!("{p}.end：结束时间必须晚于开始时间"));
            }
        }
        if course.weeks.is_empty() || course.weeks.iter().any(|week| *week == 0 || *week > 30) {
            result
                .errors
                .push(format!("{p}.weeks：必须是 1～30 的非空整数数组"));
        }
        let before = course.weeks.len();
        course.weeks.sort_unstable();
        course.weeks.dedup();
        if before != course.weeks.len() {
            result.errors.push(format!("{p}.weeks：不得包含重复周数"));
        }
        if !matches!(course.parity.as_str(), "all" | "odd" | "even") {
            result
                .errors
                .push(format!("{p}.parity：只允许 all、odd 或 even"));
        }
    }
    let mut slots: HashMap<(u8, u8), Vec<(usize, u16, u16)>> = HashMap::new();
    for (i, c) in schedule.courses.iter().enumerate() {
        if let (Some(start), Some(end)) = (valid_time(&c.start), valid_time(&c.end)) {
            for week in &c.weeks {
                slots
                    .entry((c.weekday, *week))
                    .or_default()
                    .push((i, start, end));
            }
        }
    }
    for (_, courses) in slots {
        for left in 0..courses.len() {
            for right in left + 1..courses.len() {
                if courses[left].1 < courses[right].2 && courses[right].1 < courses[left].2 {
                    result.warnings.push(format!(
                        "courses[{}] 与 courses[{}]：存在时间冲突",
                        courses[left].0, courses[right].0
                    ));
                }
            }
        }
    }
    result.valid = result.errors.is_empty();
    if result.valid {
        result.normalized_schedule = Some(schedule);
    }
    result
}

pub fn import_schedule(app: &AppHandle, source: &Path) -> Result<(Schedule, Vec<String>), String> {
    let bytes = read_limited(source)?;
    let validation = validate_schedule(&bytes);
    let schedule = validation
        .normalized_schedule
        .ok_or_else(|| validation.errors.join("\n"))?;
    let destination = ensure_schedule_storage(app)?;
    if destination.exists() {
        backup_current_schedule(app, &destination)?;
    }
    write_atomic(&destination, &serialize(&schedule)?)?;
    Ok((schedule, validation.warnings))
}

pub fn backup_current_schedule(app: &AppHandle, schedule_path: &Path) -> Result<(), String> {
    let bytes = read_limited(schedule_path)?;
    if validate_schedule(&bytes).valid {
        let backups = resolve_schedule_path(app)?
            .parent()
            .ok_or("课表目录不可用")?
            .join("backups");
        fs::create_dir_all(&backups).map_err(|error| error.to_string())?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        fs::write(backups.join(format!("schedule-{stamp}.json")), bytes)
            .map_err(|error| error.to_string())?;
        let mut files = fs::read_dir(&backups)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        files.sort_by_key(|entry| entry.file_name());
        for entry in files.into_iter().rev().skip(10) {
            if let Err(error) = fs::remove_file(entry.path()) {
                eprintln!("[schedule] backup cleanup failed: {error}");
            }
        }
    }
    Ok(())
}

pub fn open_schedule_directory(app: &AppHandle) -> Result<(), String> {
    let path = ensure_schedule_storage(app)?;
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_BYTES {
        return Err("文件不能超过 1 MiB".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}
fn serialize(schedule: &Schedule) -> Result<Vec<u8>, String> {
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(schedule).map_err(|error| error.to_string())?
    )
    .into_bytes())
}
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    let check = read_limited(&temporary)?;
    if !validate_schedule(&check).valid {
        let _ = fs::remove_file(&temporary);
        return Err("临时课表校验失败".into());
    }
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}
fn valid_time(value: &str) -> Option<u16> {
    let (h, m) = value.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let h: u16 = h.parse().ok()?;
    let m: u16 = m.parse().ok()?;
    (h < 24 && m < 60).then_some(h * 60 + m)
}
fn valid_date(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.len() != if part == &parts[0] { 4 } else { 2 })
    {
        return false;
    }
    let Ok(year) = parts[0].parse::<u16>() else {
        return false;
    };
    let Ok(month) = parts[1].parse::<u8>() else {
        return false;
    };
    let Ok(day) = parts[2].parse::<u8>() else {
        return false;
    };
    if !(1..=12).contains(&month) {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    day >= 1 && day <= days[(month - 1) as usize]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_bom_and_normalizes_weeks() {
        let raw=b"\xEF\xBB\xBF{\"semesterStart\":\"2026-09-07\",\"courses\":[{\"name\":\"\xe9\xab\x98\xe6\x95\xb0\",\"weekday\":1,\"start\":\"08:00\",\"end\":\"09:40\",\"weeks\":[2,1],\"parity\":\"all\"}]}";
        let r = validate_schedule(raw);
        assert!(r.valid);
        assert_eq!(r.normalized_schedule.unwrap().courses[0].weeks, vec![1, 2]);
    }
    #[test]
    fn rejects_invalid_time() {
        let r=validate_schedule(br#"{"semesterStart":"2026-09-07","courses":[{"name":"x","weekday":1,"start":"10:00","end":"09:00","weeks":[1],"parity":"all"}]}"#);
        assert!(!r.valid);
    }
}
