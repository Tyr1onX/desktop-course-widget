from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from .ocr_first_pipeline import recognize_ocr_first_image
from .paddle_cpu import WindowsCpuPaddleOcrEngine
from .parse_fields import FieldParserConfig
from .preprocess import PreprocessConfig


def _configure_console_encoding() -> None:
    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def _request_path(request: dict[str, Any], key: str) -> Path:
    value = request.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"worker request is missing {key}")
    return Path(value).resolve()


def _recognize(
    engine: WindowsCpuPaddleOcrEngine,
    request: dict[str, Any],
) -> dict[str, Any]:
    request_id = str(request.get("id", "")).strip()
    if not request_id:
        raise ValueError("worker request is missing id")
    input_path = _request_path(request, "input")
    output_dir = _request_path(request, "output")
    repo_root_raw = request.get("repoRoot")
    repo_root = Path(repo_root_raw).resolve() if isinstance(repo_root_raw, str) else None
    max_dimension_raw = request.get("maxDimension", 1600)
    try:
        max_dimension = max(960, min(2200, int(max_dimension_raw)))
    except (TypeError, ValueError):
        max_dimension = 1600

    def stage_callback(stage: str, title: str, detail: str) -> None:
        _emit(
            {
                "event": "stage",
                "id": request_id,
                "stage": stage,
                "title": title,
                "detail": detail,
            }
        )

    report = recognize_ocr_first_image(
        input_path=input_path,
        output_dir=output_dir,
        ocr_engine=engine,
        preprocess_config=PreprocessConfig(
            max_dimension=max_dimension,
            deskew=False,
        ),
        parser_config=FieldParserConfig(),
        repo_root=repo_root,
        stage_callback=stage_callback,
        write_diagnostics=False,
    )
    return {
        "event": "result",
        "id": request_id,
        "ok": True,
        "courseCount": report.get("courseCount", 0),
        "timings": report.get("timings", {}),
        "image": report.get("image", {}),
        "draft": str(output_dir / "draft.json"),
    }


def main() -> int:
    _configure_console_encoding()
    started = time.perf_counter()
    try:
        engine = WindowsCpuPaddleOcrEngine()
    except Exception as error:
        _emit(
            {
                "event": "fatal",
                "ok": False,
                "category": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc(limit=20),
            }
        )
        return 1

    _emit(
        {
            "event": "ready",
            "ok": True,
            "pid": os.getpid(),
            "initializationSeconds": round(time.perf_counter() - started, 6),
            "engine": engine.version_info(),
        }
    )

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id = ""
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("worker request must be a JSON object")
            request_id = str(request.get("id", "")).strip()
            command = request.get("command")
            if command == "shutdown":
                _emit({"event": "stopped", "ok": True})
                return 0
            if command != "recognize":
                raise ValueError(f"unsupported worker command: {command!r}")
            _emit(_recognize(engine, request))
        except Exception as error:
            _emit(
                {
                    "event": "result",
                    "id": request_id,
                    "ok": False,
                    "category": type(error).__name__,
                    "message": str(error),
                    "traceback": traceback.format_exc(limit=20),
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
