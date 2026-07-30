from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .paddle_cpu import WindowsCpuPaddleOcrEngine


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    bootstrap = subparsers.add_parser("bootstrap")
    bootstrap.add_argument("--output", required=True)

    benchmark = subparsers.add_parser("benchmark")
    benchmark.add_argument("--output", required=True)
    benchmark.add_argument("--repo-root", required=True)
    benchmark.add_argument("--install-metadata", required=True)

    args = parser.parse_args(argv)
    if args.command == "bootstrap":
        from . import model_bootstrap

        model_bootstrap.PaddleOcrEngine = WindowsCpuPaddleOcrEngine
        try:
            result = model_bootstrap.run(Path(args.output))
            model_bootstrap.print(
                model_bootstrap.json.dumps(result, ensure_ascii=False, indent=2)
            )
            return 0
        except Exception as error:
            print(
                model_bootstrap.json.dumps(
                    {"success": False, "error": f"{type(error).__name__}: {error}"},
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 1

    from . import real_benchmark

    real_benchmark.PaddleOcrEngine = WindowsCpuPaddleOcrEngine
    try:
        payload = real_benchmark.run(
            Path(args.output), Path(args.repo_root), Path(args.install_metadata)
        )
        print(
            real_benchmark.json.dumps(
                {"success": True, "comparisons": payload["comparisons"]},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    except Exception as error:
        print(
            real_benchmark.json.dumps(
                {"success": False, "error": f"{type(error).__name__}: {error}"},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
