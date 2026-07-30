from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .benchmark import validate_confidence_thresholds, validate_overlap_threshold
from .ground_truth import GROUND_TRUTHS, write_ground_truth
from .ocr import FixtureOcrEngine, PaddleOcrEngine
from .parse_fields import FieldParserConfig
from .pipeline import recognize_image
from .preprocess import PreprocessConfig
from .synthetic import generate_synthetic_sample, scenarios


def _configure_console_encoding() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="标准网格课表截图识别实验")
    sub = root.add_subparsers(dest="command", required=True)
    recognize = sub.add_parser("recognize")
    recognize.add_argument("--input", required=True)
    recognize.add_argument("--output", required=True, help="输出目录")
    recognize.add_argument("--debug-dir", help="兼容参数；当前与 --output 相同")
    recognize.add_argument("--engine", choices=["paddle", "fixture"], default="paddle")
    recognize.add_argument("--fixture")
    recognize.add_argument("--scale", type=float, default=1.0)
    recognize.add_argument("--no-deskew", action="store_true")
    recognize.add_argument("--high-confidence", type=float, default=0.90)
    recognize.add_argument("--review-confidence", type=float, default=0.55)
    recognize.add_argument("--ocr-mode", choices=["block", "full"], default="block")
    recognize.add_argument("--assignment-overlap-threshold", type=float, default=0.35)
    recognize.add_argument("--ground-truth")
    recognize.add_argument("--repo-root")
    synth = sub.add_parser("generate-synthetic")
    synth.add_argument("--output", required=True)
    synth.add_argument("--scenario", choices=sorted(scenarios()), action="append")
    return root


def main(argv: list[str] | None = None) -> int:
    _configure_console_encoding()
    args = parser().parse_args(argv)
    try:
        if args.command == "generate-synthetic":
            names = args.scenario or sorted(scenarios())
            payload = {}
            for name in names:
                generated = {
                    key: str(value)
                    for key, value in generate_synthetic_sample(args.output, name).items()
                }
                if name in GROUND_TRUTHS:
                    generated["groundTruth"] = str(write_ground_truth(name, args.output))
                payload[name] = generated
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0

        validate_confidence_thresholds(
            args.review_confidence, args.high_confidence
        )
        validate_overlap_threshold(args.assignment_overlap_threshold)
        if args.engine == "fixture":
            if not args.fixture:
                raise ValueError("--engine fixture requires --fixture")
            engine = FixtureOcrEngine(args.fixture)
        else:
            engine = PaddleOcrEngine()
        report = recognize_image(
            input_path=args.input,
            output_dir=args.output,
            ocr_engine=engine,
            preprocess_config=PreprocessConfig(
                scale=args.scale, deskew=not args.no_deskew
            ),
            parser_config=FieldParserConfig(
                high_confidence=args.high_confidence,
                review_confidence=args.review_confidence,
            ),
            repo_root=args.repo_root,
            ocr_mode=args.ocr_mode,
            assignment_overlap_threshold=args.assignment_overlap_threshold,
            ground_truth_path=args.ground_truth,
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(f"screenshot-import failed: {error}", file=sys.stderr)
        return 1
