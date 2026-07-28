from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing expected block: {label}")
    return text.replace(old, new, 1)


def cut_between(text: str, start: str, end: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"missing start marker: {label}")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"missing end marker: {label}")
    return text[:start_index] + text[end_index:]


settings_path = Path("src/settings.ts")
settings = settings_path.read_text(encoding="utf-8")
settings = cut_between(settings, "type BackupPreview = {", "type CatalogCourse = {", "backup types")
settings = replace_once(settings, "let backupPreview: BackupPreview | null = null\n", "", "backup state")
settings = replace_once(settings, "  const preview = backupPreview\n", "", "backup preview binding")
settings = cut_between(
    settings,
    '      <div class="data-card backup-card">',
    '      <div class="data-card">\n        <h3>本地数据</h3>',
    "backup surface",
)
settings = replace_once(
    settings,
    '''  document.querySelector('[data-action="export-backup"]')?.addEventListener('click', () => void exportBackup())
  document.querySelector('[data-action="choose-backup"]')?.addEventListener('click', () => void chooseBackup())
  document.querySelector('[data-action="restore-backup"]')?.addEventListener('click', () => void restoreBackup())
  document.querySelector('[data-action="cancel-backup-preview"]')?.addEventListener('click', () => {
    backupPreview = null
    surfaceMessage = '已取消恢复。'
    render()
  })
''',
    "",
    "backup event bindings",
)
settings = cut_between(
    settings,
    "async function exportBackup(): Promise<void> {",
    "async function toggleAutostart(): Promise<void> {",
    "backup functions",
)
for token in (
    "BackupPreview",
    "BackupExportResult",
    "BackupRestoreResult",
    "backupPreview",
    "export-backup",
    "choose-backup",
    "restore-backup",
    "cancel-backup-preview",
    "export_backup",
    "choose_backup_for_restore",
    "restore_backup",
):
    if token in settings:
        raise RuntimeError(f"backup reference remains in settings.ts: {token}")
settings_path.write_text(settings, encoding="utf-8", newline="\n")

lib_path = Path("src-tauri/src/lib.rs")
lib = lib_path.read_text(encoding="utf-8")
lib = replace_once(lib, "mod data_backup;\n", "", "data_backup module")
for line in (
    "            data_backup::export_backup,\n",
    "            data_backup::choose_backup_for_restore,\n",
    "            data_backup::restore_backup\n",
):
    lib = replace_once(lib, line, "", line.strip())
if "data_backup" in lib:
    raise RuntimeError("data_backup reference remains in lib.rs")
lib_path.write_text(lib, encoding="utf-8", newline="\n")

backup_module = Path("src-tauri/src/data_backup.rs")
if not backup_module.exists():
    raise RuntimeError("data_backup.rs is already missing")
backup_module.unlink()

css_path = Path("src/settings.css")
css = css_path.read_text(encoding="utf-8")
marker = "\n/* Local backup and recovery */"
marker_index = css.find(marker)
if marker_index < 0:
    raise RuntimeError("backup CSS marker is missing")
css = css[:marker_index].rstrip() + "\n"
css_path.write_text(css, encoding="utf-8", newline="\n")

readme_path = Path("README.md")
readme = readme_path.read_text(encoding="utf-8")
readme = replace_once(
    readme,
    "- 本地备份与恢复：可导出完整课表和作息设置，恢复前预览并自动创建安全快照。\n",
    "",
    "README feature bullet",
)
readme = replace_once(
    readme,
    "9. 可在“课表与数据”中导出完整备份；恢复备份前会先展示内容预览。\n",
    "",
    "README first-use step",
)
readme = replace_once(
    readme,
    "Excel 文件和备份文件只在本机处理，不会上传。程序不会主动保留姓名和学号；教师名称是否出现取决于课表内容与解析结果。",
    "Excel 文件只在本机处理，不会上传。程序不会主动保留姓名和学号；教师名称是否出现取决于课表内容与解析结果。",
    "README privacy wording",
)
readme = replace_once(
    readme,
    "- `recovery-snapshots/`：恢复备份前自动创建的安全快照，最多保留最近五份。\n",
    "",
    "README recovery snapshots",
)
readme_path.write_text(readme, encoding="utf-8", newline="\n")

changelog_path = Path("CHANGELOG.md")
changelog = changelog_path.read_text(encoding="utf-8")
changelog = replace_once(
    changelog,
    "- Updated repository documentation for the current release and backup workflow.\n",
    "- Removed the low-frequency manual backup and restore surface to keep the settings experience focused.\n- Updated repository documentation for the current release.\n",
    "changelog unreleased entry",
)
changelog_path.write_text(changelog, encoding="utf-8", newline="\n")

source_roots = [Path("src"), Path("src-tauri/src")]
for root in source_roots:
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in {".ts", ".css", ".rs", ".html"}:
            continue
        content = path.read_text(encoding="utf-8")
        for token in ("export_backup", "choose_backup_for_restore", "restore_backup", "backupPreview", "backup-preview", "backup-card"):
            if token in content:
                raise RuntimeError(f"backup reference remains in {path}: {token}")

print("manual backup feature removed")
