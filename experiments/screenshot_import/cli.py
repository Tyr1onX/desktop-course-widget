from __future__ import annotations

import argparse
import json
import sys

from .benchmark import validate_confidence_thresholds, validate_overlap_threshold
from .corpus import build_corpus_variants, fetch_public_corpus
from .ground_truth import GROUND_TRUTHS, write_ground_truth
from .ocr import FixtureOcrEngine
from .ocr_first_pipeline import recognize_ocr_first_image
from .paddle_cpu import WindowsCpuPaddleOcrEngine
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
    root = argparse.ArgumentParser(description="课表截图 OCR-first 识别实验")
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
    recognize.add_argument(
        "--ocr-mode",
        choices=["ocr-first", "block", "full"],
        default="ocr-first",
        help="ocr-first 为通用主流程；block/full 仅保留为旧标准网格回归基线",
    )
    recognize.add_argument("--assignment-overlap-threshold", type=float, default=0.35)
    recognize.add_argument("--ground-truth")
    recognize.add_argument("--repo-root")

    synth = sub.add_parser("generate-synthetic")
    synth.add_argument("--output", required=True)
    synth.add_argument("--scenario", choices=sorted(scenarios()), action="append")

    fetch = sub.add_parser(
        "fetch-corpus",
        help="按公开许可清单下载课表图片到本地临时目录",
    )
    fetch.add_argument("--output", required=True)
    fetch.add_argument("--manifest")
    fetch.add_argument("--id", dest="sample_ids", action="append")
    fetch.add_argument("--force", action="store_true")

    variants = sub.add_parser(
        "build-corpus-variants",
        help="为本地公开样本生成压缩、模糊、低对比度和裁切变体",
    )
    variants.add_argument("--corpus", required=True)
    variants.add_argument("--manifest")
    variants.add_argument("--id", dest="sample_ids", action="append")
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

        if args.command == "fetch-corpus":
            report = fetch_public_corpus(
                args.output,
                manifest_path=args.manifest,
                sample_ids=args.sample_ids,
                force=args.force,
            )
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0

        if args.command == "build-corpus-variants":
            report = build_corpus_variants(
                args.corpus,
                manifest_path=args.manifest,
                sample_ids=args.sample_ids,
            )
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0

        validate_confidence_thresholds(args.review_confidence, args.high_confidence)
        validate_overlap_threshold(args.assignment_overlap_threshold)
        if args.engine == "fixture":
            if not args.fixture:
                raise ValueError("--engine fixture requires --fixture")
            engine = FixtureOcrEngine(args.fixture)
        else:
            engine = WindowsCpuPaddleOcrEngine()
        common = {
            "input_path": args.input,
            "output_dir": args.output,
            "ocr_engine": engine,
            "preprocess_config": PreprocessConfig(
                scale=args.scale, deskew=not args.no_deskew
            ),
            "parser_config": FieldParserConfig(
                high_confidence=args.high_confidence,
                review_confidence=args.review_confidence,
            ),
            "repo_root": args.repo_root,
            "assignment_overlap_threshold": args.assignment_overlap_threshold,
            "ground_truth_path": args.ground_truth,
        }
        if args.ocr_mode == "ocr-first":
            report = recognize_ocr_first_image(**common)
        else:
            report = recognize_image(**common, ocr_mode=args.ocr_mode)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(f"screenshot-import failed: {error}", file=sys.stderr)
        return 1
