use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const TRANSACTION_DIRECTORY: &str = ".schedule-transaction";
const PENDING_DIRECTORY: &str = "pending";
const MANIFEST_FILE: &str = "manifest.json";
const COMMITTED_FILE: &str = "committed";

static TRANSACTION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone)]
pub(crate) struct FileChange {
    path: PathBuf,
    content: Option<Vec<u8>>,
}

impl FileChange {
    pub(crate) fn write(path: PathBuf, content: Vec<u8>) -> Self {
        Self {
            path,
            content: Some(content),
        }
    }

    pub(crate) fn delete(path: PathBuf) -> Self {
        Self {
            path,
            content: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransactionManifest {
    entries: Vec<ManifestEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    relative_path: String,
    existed: bool,
    backup_name: Option<String>,
}

pub(crate) fn commit(app: &AppHandle, changes: Vec<FileChange>) -> Result<(), String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let _guard = transaction_guard()?;
    recover_pending_at_root(&root)?;
    cleanup_legacy_temporaries_at_root(&root)?;
    commit_at_root(&root, changes, None, true)
}

pub(crate) fn recover_pending(app: &AppHandle) -> Result<(), String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let _guard = transaction_guard()?;
    recover_pending_at_root(&root)?;
    cleanup_legacy_temporaries_at_root(&root)
}

pub(crate) fn replace_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let _guard = transaction_guard()?;
    replace_file_unlocked(path, bytes)
}

fn transaction_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    TRANSACTION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "数据事务锁已损坏".to_owned())
}

fn commit_at_root(
    root: &Path,
    changes: Vec<FileChange>,
    fail_after: Option<usize>,
    rollback_on_error: bool,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    validate_changes(root, &changes)?;

    let transaction_root = root.join(TRANSACTION_DIRECTORY);
    let pending = transaction_root.join(PENDING_DIRECTORY);
    if pending.exists() {
        recover_pending_at_root(root)?;
    }
    fs::create_dir_all(&pending).map_err(|error| error.to_string())?;

    let manifest = snapshot_changes(root, &pending, &changes)?;
    let manifest_bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?
    );
    replace_file_unlocked(&pending.join(MANIFEST_FILE), manifest_bytes.as_bytes())?;

    let apply_result = apply_changes(&changes, fail_after);
    if let Err(error) = apply_result {
        if !rollback_on_error {
            return Err(error);
        }
        return match restore_manifest(root, &pending, &manifest) {
            Ok(()) => {
                let _ = fs::remove_dir_all(&pending);
                Err(error)
            }
            Err(rollback_error) => Err(format!("{error}；恢复操作前数据失败：{rollback_error}")),
        };
    }

    write_synced(&pending.join(COMMITTED_FILE), b"committed\n")?;
    if let Err(error) = fs::remove_dir_all(&pending) {
        eprintln!("[data-transaction] committed transaction cleanup failed: {error}");
    }
    Ok(())
}

fn validate_changes(root: &Path, changes: &[FileChange]) -> Result<(), String> {
    let mut targets = std::collections::HashSet::new();
    for change in changes {
        let relative = relative_target(root, &change.path)?;
        if !targets.insert(relative) {
            return Err("同一事务不能重复修改同一个文件".into());
        }
    }
    Ok(())
}

fn snapshot_changes(
    root: &Path,
    pending: &Path,
    changes: &[FileChange],
) -> Result<TransactionManifest, String> {
    let mut entries = Vec::with_capacity(changes.len());
    for (index, change) in changes.iter().enumerate() {
        let relative = relative_target(root, &change.path)?;
        if change.path.exists() && !change.path.is_file() {
            return Err(format!("事务目标不是普通文件：{}", change.path.display()));
        }
        let existed = change.path.exists();
        let backup_name = if existed {
            let name = format!("backup-{index}.bin");
            let bytes = fs::read(&change.path).map_err(|error| error.to_string())?;
            write_synced(&pending.join(&name), &bytes)?;
            Some(name)
        } else {
            None
        };
        entries.push(ManifestEntry {
            relative_path: path_to_manifest_string(&relative),
            existed,
            backup_name,
        });
    }
    Ok(TransactionManifest { entries })
}

fn apply_changes(changes: &[FileChange], fail_after: Option<usize>) -> Result<(), String> {
    for (index, change) in changes.iter().enumerate() {
        if fail_after == Some(index) {
            return Err(format!("测试注入：第 {index} 步写入前失败"));
        }
        match &change.content {
            Some(bytes) => replace_file_unlocked(&change.path, bytes)?,
            None => {
                if change.path.exists() {
                    fs::remove_file(&change.path).map_err(|error| error.to_string())?;
                }
            }
        }
    }
    if fail_after == Some(changes.len()) {
        return Err("测试注入：全部文件写入后、提交标记前失败".into());
    }
    Ok(())
}

fn recover_pending_at_root(root: &Path) -> Result<(), String> {
    let pending = root.join(TRANSACTION_DIRECTORY).join(PENDING_DIRECTORY);
    if !pending.exists() {
        return Ok(());
    }
    if pending.join(COMMITTED_FILE).exists() {
        if let Err(error) = fs::remove_dir_all(&pending) {
            eprintln!("[data-transaction] committed recovery cleanup failed: {error}");
        }
        return Ok(());
    }

    let manifest_path = pending.join(MANIFEST_FILE);
    if !manifest_path.exists() {
        fs::remove_dir_all(&pending).map_err(|error| error.to_string())?;
        return Ok(());
    }

    let manifest_bytes = fs::read(&manifest_path).map_err(|error| error.to_string())?;
    let manifest: TransactionManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("未完成数据事务的恢复清单损坏：{error}"))?;
    restore_manifest(root, &pending, &manifest)?;
    fs::remove_dir_all(&pending).map_err(|error| error.to_string())
}

fn restore_manifest(
    root: &Path,
    pending: &Path,
    manifest: &TransactionManifest,
) -> Result<(), String> {
    for entry in &manifest.entries {
        let relative = manifest_path(&entry.relative_path)?;
        let target = root.join(relative);
        if entry.existed {
            let backup_name = entry
                .backup_name
                .as_deref()
                .ok_or("恢复清单缺少备份文件名")?;
            let backup = fs::read(pending.join(backup_name)).map_err(|error| error.to_string())?;
            replace_file_unlocked(&target, &backup)?;
        } else if target.exists() {
            fs::remove_file(&target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn relative_target(root: &Path, target: &Path) -> Result<PathBuf, String> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| format!("事务文件不在应用数据目录中：{}", target.display()))?;
    validate_relative_path(relative)?;
    Ok(relative.to_path_buf())
}

fn validate_relative_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("事务恢复路径无效".into());
    }
    Ok(())
}

fn path_to_manifest_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn manifest_path(value: &str) -> Result<PathBuf, String> {
    let path = value.split('/').collect::<PathBuf>();
    validate_relative_path(&path)?;
    Ok(path)
}

fn replace_file_unlocked(path: &Path, bytes: &[u8]) -> Result<(), String> {
    replace_file_with(path, bytes, |temporary, destination| {
        fs::rename(temporary, destination)
    })
}

fn replace_file_with<F>(path: &Path, bytes: &[u8], rename: F) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    let parent = path.parent().ok_or("数据目录不可用")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = unique_temporary_path(path)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);

        let check = fs::read(&temporary).map_err(|error| error.to_string())?;
        if check != bytes {
            return Err("临时文件写入校验失败".into());
        }
        rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn unique_temporary_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("数据目录不可用")?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("数据文件名无效")?;
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    for offset in 0..100u32 {
        let candidate = parent.join(format!(
            ".{file_name}.txn-{}-{seed}-{offset}",
            std::process::id()
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法创建事务临时文件".into())
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("数据目录不可用")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn cleanup_legacy_temporaries_at_root(root: &Path) -> Result<(), String> {
    cleanup_legacy_temporaries_in(root)?;
    cleanup_legacy_temporaries_in(&root.join("schedules"))
}

fn cleanup_legacy_temporaries_in(directory: &Path) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let temporary = entry.path();
        if !temporary.is_file() {
            continue;
        }
        let Some(name) = temporary.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.ends_with(".json.tmp") {
            continue;
        }
        let target = temporary.with_file_name(name.trim_end_matches(".tmp"));
        if target.exists() {
            fs::remove_file(&temporary).map_err(|error| error.to_string())?;
            continue;
        }
        let bytes = fs::read(&temporary).map_err(|error| error.to_string())?;
        if serde_json::from_slice::<serde_json::Value>(&bytes).is_ok() {
            fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&temporary).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "course-widget-{name}-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write(path: &Path, value: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, value).unwrap();
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    fn catalog_changes(root: &Path) -> Vec<FileChange> {
        vec![
            FileChange::write(root.join("schedules/new.json"), br#"{"id":"new"}"#.to_vec()),
            FileChange::write(
                root.join("settings.json"),
                br#"{"settings":"new"}"#.to_vec(),
            ),
            FileChange::write(root.join("schedule.json"), br#"{"active":"new"}"#.to_vec()),
            FileChange::write(
                root.join("schedules/index.json"),
                br#"{"activeScheduleId":"new"}"#.to_vec(),
            ),
        ]
    }

    fn seed_catalog(root: &Path) {
        write(&root.join("settings.json"), r#"{"settings":"old"}"#);
        write(&root.join("schedule.json"), r#"{"active":"old"}"#);
        write(
            &root.join("schedules/index.json"),
            r#"{"activeScheduleId":"old"}"#,
        );
        write(&root.join("schedules/old.json"), r#"{"id":"old"}"#);
    }

    fn assert_original_catalog(root: &Path) {
        assert_eq!(read(&root.join("settings.json")), r#"{"settings":"old"}"#);
        assert_eq!(read(&root.join("schedule.json")), r#"{"active":"old"}"#);
        assert_eq!(
            read(&root.join("schedules/index.json")),
            r#"{"activeScheduleId":"old"}"#
        );
        assert_eq!(read(&root.join("schedules/old.json")), r#"{"id":"old"}"#);
        assert!(!root.join("schedules/new.json").exists());
    }

    #[test]
    fn import_transaction_commits_all_files_together() {
        let root = test_root("import-success");
        seed_catalog(&root);
        commit_at_root(&root, catalog_changes(&root), None, true).unwrap();

        assert_eq!(read(&root.join("schedules/new.json")), r#"{"id":"new"}"#);
        assert_eq!(read(&root.join("settings.json")), r#"{"settings":"new"}"#);
        assert_eq!(read(&root.join("schedule.json")), r#"{"active":"new"}"#);
        assert_eq!(
            read(&root.join("schedules/index.json")),
            r#"{"activeScheduleId":"new"}"#
        );
        recover_pending_at_root(&root).unwrap();
        assert_eq!(read(&root.join("schedule.json")), r#"{"active":"new"}"#);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn import_transaction_rolls_back_every_injected_failure() {
        for fail_after in 0..=4 {
            let root = test_root(&format!("import-fail-{fail_after}"));
            seed_catalog(&root);
            let result = commit_at_root(&root, catalog_changes(&root), Some(fail_after), true);
            assert!(result.is_err());
            assert_original_catalog(&root);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn activation_failure_restores_schedule_and_index() {
        let root = test_root("activate");
        seed_catalog(&root);
        let changes = vec![
            FileChange::write(root.join("schedule.json"), br#"{"active":"next"}"#.to_vec()),
            FileChange::write(
                root.join("schedules/index.json"),
                br#"{"activeScheduleId":"next"}"#.to_vec(),
            ),
        ];
        assert!(commit_at_root(&root, changes, Some(1), true).is_err());
        assert_original_catalog(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delete_failure_restores_removed_schedule_and_index() {
        let root = test_root("delete");
        seed_catalog(&root);
        let changes = vec![
            FileChange::write(
                root.join("schedules/index.json"),
                br#"{"activeScheduleId":"next"}"#.to_vec(),
            ),
            FileChange::delete(root.join("schedules/old.json")),
        ];
        assert!(commit_at_root(&root, changes, Some(2), true).is_err());
        assert_original_catalog(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn course_save_failure_keeps_old_catalog_and_active_schedule() {
        let root = test_root("save-course");
        seed_catalog(&root);
        let changes = vec![
            FileChange::write(
                root.join("schedules/old.json"),
                br#"{"id":"old","courses":["new"]}"#.to_vec(),
            ),
            FileChange::write(
                root.join("schedule.json"),
                br#"{"active":"new-course"}"#.to_vec(),
            ),
        ];
        assert!(commit_at_root(&root, changes, Some(1), true).is_err());
        assert_original_catalog(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_recovery_restores_interrupted_transaction() {
        let root = test_root("restart-recovery");
        seed_catalog(&root);
        assert!(commit_at_root(&root, catalog_changes(&root), Some(2), false,).is_err());

        recover_pending_at_root(&root).unwrap();
        assert_original_catalog(&root);
        assert!(!root
            .join(TRANSACTION_DIRECTORY)
            .join(PENDING_DIRECTORY)
            .exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_temporary_file_never_removes_a_valid_target() {
        let root = test_root("legacy-temp");
        write(&root.join("schedule.json"), r#"{"active":"old"}"#);
        write(
            &root.join("schedule.json.tmp"),
            r#"{"active":"unfinished"}"#,
        );
        cleanup_legacy_temporaries_at_root(&root).unwrap();
        assert_eq!(read(&root.join("schedule.json")), r#"{"active":"old"}"#);
        assert!(!root.join("schedule.json.tmp").exists());

        write(
            &root.join("settings.json.tmp"),
            r#"{"settings":"recovered"}"#,
        );
        cleanup_legacy_temporaries_at_root(&root).unwrap();
        assert_eq!(
            read(&root.join("settings.json")),
            r#"{"settings":"recovered"}"#
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_failure_preserves_existing_file() {
        let root = test_root("rename-failure");
        let path = root.join("schedule.json");
        write(&path, r#"{"active":"old"}"#);
        let result =
            replace_file_with(&path, br#"{"active":"new"}"#, |_temporary, _destination| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "simulated Windows file lock",
                ))
            });
        assert!(result.is_err());
        assert_eq!(read(&path), r#"{"active":"old"}"#);
        assert_eq!(
            fs::read_dir(&root).unwrap().filter_map(Result::ok).count(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }
}
