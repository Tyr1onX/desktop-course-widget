from __future__ import annotations

import os
import runpy
import sys
from types import ModuleType
from typing import Any


def install_mkldnn_safe_constructor(paddleocr_module: ModuleType) -> None:
    """Force PaddleOCR CPU inference away from the Paddle 3.3.x oneDNN/PIR path."""
    os.environ.setdefault("FLAGS_use_mkldnn", "0")
    current = getattr(paddleocr_module, "PaddleOCR")
    if getattr(current, "__screenshot_import_mkldnn_disabled__", False):
        return

    def safe_paddle_ocr(*args: Any, **kwargs: Any) -> Any:
        kwargs["enable_mkldnn"] = False
        return current(*args, **kwargs)

    safe_paddle_ocr.__screenshot_import_mkldnn_disabled__ = True
    safe_paddle_ocr.__wrapped__ = current
    paddleocr_module.PaddleOCR = safe_paddle_ocr


def run_module_with_safe_paddleocr(module_name: str, arguments: list[str]) -> None:
    try:
        import paddleocr
    except Exception as error:
        raise RuntimeError("PaddleOCR must be installed before the safe runtime wrapper is used") from error

    install_mkldnn_safe_constructor(paddleocr)
    sys.argv = [module_name, *arguments]
    runpy.run_module(module_name, run_name="__main__")


def main(argv: list[str] | None = None) -> int:
    values = list(sys.argv[1:] if argv is None else argv)
    if not values:
        print("usage: python -m experiments.screenshot_import.paddle_runtime <module> [args...]", file=sys.stderr)
        return 2
    run_module_with_safe_paddleocr(values[0], values[1:])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
