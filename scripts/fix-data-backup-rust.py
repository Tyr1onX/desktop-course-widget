from pathlib import Path

path = Path("src-tauri/src/data_backup.rs")
text = path.read_text(encoding="utf-8")
old = '''    if active_legacy != legacy_schedule(expected_active) {
        return Err("桌面组件课表暂存校验失败".into());
    }
'''
new = '''    let active_bytes = serde_json::to_vec(&active_legacy).map_err(|error| error.to_string())?;
    let expected_bytes = serde_json::to_vec(&legacy_schedule(expected_active))
        .map_err(|error| error.to_string())?;
    if active_bytes != expected_bytes {
        return Err("桌面组件课表暂存校验失败".into());
    }
'''
if old not in text:
    raise SystemExit("Could not locate staged schedule comparison")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
