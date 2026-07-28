from pathlib import Path

script_path = Path("scripts/apply_import_draft_foundation.py")
source = script_path.read_text(encoding="utf-8")
old = '''replace_once(
    "src/settings.ts",
    "import { getCurrentWindow } from '@tauri-apps/api/window'\\nimport scheduleData from './data/schedule.json'",
    "import { getCurrentWindow } from '@tauri-apps/api/window'\\nimport type { ImportDraft } from './import-draft'\\nimport scheduleData from './data/schedule.json'",
)'''
new = '''replace_once(
    "src/settings.ts",
    "import scheduleData from './data/schedule.json'",
    "import type { ImportDraft } from './import-draft'\\nimport scheduleData from './data/schedule.json'",
)'''
if source.count(old) != 1:
    raise RuntimeError(f"expected one import replacement block, found {source.count(old)}")
source = source.replace(old, new, 1)
exec(compile(source, str(script_path), "exec"))
