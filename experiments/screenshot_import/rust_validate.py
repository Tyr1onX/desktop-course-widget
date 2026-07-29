from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


class RustValidationError(RuntimeError):
    pass


def validate_with_rust(draft_path: str | Path, repo_root: str | Path | None = None) -> dict[str, Any]:
    root = Path(repo_root) if repo_root else Path(__file__).resolve().parents[2]
    manifest = root / "src-tauri" / "Cargo.toml"
    if not manifest.exists():
        return {
            "available": False,
            "strictValid": None,
            "structuralValid": None,
            "reviewOnly": None,
            "reason": f"Rust manifest not found at {manifest}",
        }
    command = [
        "cargo", "run", "--quiet", "--manifest-path", str(manifest),
        "--example", "validate_import_draft", "--", str(Path(draft_path).resolve()),
    ]
    result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=180)
    output = result.stdout.strip()
    try:
        payload = json.loads(output) if output else {}
    except json.JSONDecodeError as error:
        raise RustValidationError(f"Rust validator returned invalid JSON: {output}\n{result.stderr}") from error
    if result.returncode != 0:
        raise RustValidationError(payload.get("error") or result.stderr.strip() or "Rust validation failed")
    return payload
