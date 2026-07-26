from pathlib import Path

rust_path = Path("src-tauri/src/data_backup.rs")
rust = rust_path.read_text(encoding="utf-8")
old_result = "    let apply_result = (|| {\n"
new_result = "    let apply_result: Result<(), String> = (|| {\n"
if old_result not in rust:
    raise SystemExit("Could not locate restore apply result")
rust_path.write_text(rust.replace(old_result, new_result, 1), encoding="utf-8", newline="\n")

ui_path = Path("src/backup-ui.ts")
ui = ui_path.read_text(encoding="utf-8")
old_observer = """const observer = new MutationObserver(renderBackupPanel)
observer.observe(document.documentElement, { childList: true, subtree: true })
renderBackupPanel()
"""
new_observer = """const observer = new MutationObserver(() => {
  const host = document.querySelector<HTMLElement>('.data-card')
  const panel = host?.querySelector<HTMLElement>('[data-backup-panel]')
  if (host && !panel) renderBackupPanel()
})
observer.observe(document.documentElement, { childList: true, subtree: true })
renderBackupPanel()
"""
if old_observer not in ui:
    raise SystemExit("Could not locate backup panel observer")
ui_path.write_text(ui.replace(old_observer, new_observer, 1), encoding="utf-8", newline="\n")
