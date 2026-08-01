from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .benchmark import validate_confidence_thresholds, validate_overlap_threshold
from .corpus import build_corpus_variants, fetch_public_corpus
from .corpus_benchmark import run_corpus_benchmark
from .ground_truth import GROUND_TRUTHS, write_ground_truth
from .ocr import FixtureOcrEngine
from .ocr_first_pipeline import recognize_ocr_first_image
from .paddle_cpu import WindowsCpuPaddleOcrEngine
from .parse_fields import FieldParserConfig
from .pipeline import recognize_image
from .preprocess import PreprocessConfig
from .synthetic import generate_synthetic_sample, scenarios
from .synthetic_chinese_corpus import (
    generate_chinese_timetable_corpus,
    style_names as chinese_style_names,
)


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

    chinese = sub.add_parser(
        "generate-chinese-corpus",
        help="生成多种中文课表视觉样本、Fixture OCR 和课程级真值",
    )
    chinese.add_argument("--output", required=True)
    chinese.add_argument(
        "--style",
        dest="styles",
        choices=chinese_style_names(),
        action="append",
    )

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

    corpus_benchmark = sub.add_parser(
        "benchmark-corpus",
        help="批量运行公开样本及其变体并生成稳定性报告",
    )
    corpus_benchmark.add_argument("--corpus", required=True)
    corpus_benchmark.add_argument("--output", required=True)
    corpus_benchmark.add_argument("--manifest")
    corpus_benchmark.add_argument("--id", dest="sample_ids", action="append")
    input_group = corpus_benchmark.add_mutually_exclusive_group()
    input_group.add_argument("--originals-only", action="store_true")
    input_group.add_argument("--variants-only", action="store_true")
    corpus_benchmark.add_argument("--max-cases", type=int)
    corpus_benchmark.add_argument("--scale", type=float, default=1.0)
    corpus_benchmark.add_argument("--no-deskew", action="store_true")
    corpus_benchmark.add_argument("--high-confidence", type=float, default=0.90)
    corpus_benchmark.add_argument("--review-confidence", type=float, default=0.55)
    corpus_benchmark.add_argument(
        "--assignment-overlap-threshold", type=float, default=0.35
    )
    corpus_benchmark.add_argument("--repo-root")
    corpus_benchmark.add_argument(
        "--allow-errors",
        action="store_true",
        help="仅记录运行异常，不把异常作为基准失败",
    )
    corpus_benchmark.add_argument(
        "--require-positive",
        action="store_true",
        help="要求所有正样本和布局样本都形成课程记录",
    )
    corpus_benchmark.add_argument(
        "--allow-negative-recognition",
        action="store_true",
        help="暂时允许负样本被识别为课程表，仅记录不阻塞",
    )
    corpus_benchmark.add_argument(
        "--strict-incomplete",
        action="store_true",
        help="要求裁切变体被拒绝，或产生字段复核、字段缺失或明确的不完整截图提示",
    )
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

        if args.command == "generate-chinese-corpus":
            generated = generate_chinese_timetable_corpus(args.output, args.styles)
            payload = {
                name: {key: str(value) for key, value in paths.items()}
                for name, paths in generated.items()
            }
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

        if args.command == "benchmark-corpus":
            validate_confidence_thresholds(
                args.review_confidence, args.high_confidence
            )
            validate_overlap_threshold(args.assignment_overlap_threshold)
            engine = WindowsCpuPaddleOcrEngine()
            preprocess_config = PreprocessConfig(
                scale=args.scale,
                deskew=not args.no_deskew,
            )
            parser_config = FieldParserConfig(
                high_confidence=args.high_confidence,
                review_confidence=args.review_confidence,
            )

            def recognize_case(input_path: Path, case_output: Path) -> dict:
                return recognize_ocr_first_image(
                    input_path=input_path,
                    output_dir=case_output,
                    ocr_engine=engine,
                    preprocess_config=preprocess_config,
                    parser_config=parser_config,
                    repo_root=args.repo_root,
                    assignment_overlap_threshold=args.assignment_overlap_threshold,
                )

            report = run_corpus_benchmark(
                args.corpus,
                args.output,
                recognize_case,
                manifest_path=args.manifest,
                sample_ids=args.sample_ids,
                include_originals=not args.variants_only,
                include_variants=not args.originals_only,
                max_cases=args.max_cases,
                fail_on_error=not args.allow_errors,
                require_positive=args.require_positive,
                strict_negative=not args.allow_negative_recognition,
                strict_incomplete=args.strict_incomplete,
            )
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["gatePassed"] else 2

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
