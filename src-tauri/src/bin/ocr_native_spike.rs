use std::{env, path::PathBuf, process::ExitCode, time::Instant};

use image::DynamicImage;
use ocr_rs::{OcrEngine, OcrEngineConfig};
use serde::Serialize;

const DEFAULT_MAX_SIDE: u32 = 1600;
const DEFAULT_COLD_LIMIT_SECONDS: f64 = 30.0;
const DEFAULT_WARM_LIMIT_SECONDS: f64 = 15.0;

#[derive(Debug)]
struct Args {
    images: Vec<PathBuf>,
    detection_model: PathBuf,
    recognition_model: PathBuf,
    charset: PathBuf,
    expected_terms: Vec<String>,
    minimum_expected_terms: usize,
    max_side: u32,
    max_cold_seconds: f64,
    max_warm_seconds: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecognizedItem {
    text: String,
    confidence: f32,
    bounds_debug: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecognitionRun {
    image_name: String,
    original_width: u32,
    original_height: u32,
    working_width: u32,
    working_height: u32,
    image_decode_ms: u128,
    recognition_ms: u128,
    run_total_ms: u128,
    matched_expected_terms: Vec<String>,
    item_count: usize,
    items: Vec<RecognizedItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpikeReport {
    engine: &'static str,
    external_processes: usize,
    engine_initialization_ms: u128,
    cold_total_ms: u128,
    warm_run_limit_ms: u128,
    cold_run_limit_ms: u128,
    all_gates_passed: bool,
    failures: Vec<String>,
    runs: Vec<RecognitionRun>,
}

fn parse_args() -> Result<Args, String> {
    let mut images = Vec::new();
    let mut detection_model = None;
    let mut recognition_model = None;
    let mut charset = None;
    let mut expected_terms = Vec::new();
    let mut minimum_expected_terms = 1usize;
    let mut max_side = DEFAULT_MAX_SIDE;
    let mut max_cold_seconds = DEFAULT_COLD_LIMIT_SECONDS;
    let mut max_warm_seconds = DEFAULT_WARM_LIMIT_SECONDS;
    let mut args = env::args().skip(1);

    while let Some(argument) = args.next() {
        let value = |args: &mut std::iter::Skip<std::env::Args>, name: &str| {
            args.next().ok_or_else(|| format!("missing value for {name}"))
        };
        match argument.as_str() {
            "--image" => images.push(PathBuf::from(value(&mut args, "--image")?)),
            "--det-model" => detection_model = Some(PathBuf::from(value(&mut args, "--det-model")?)),
            "--rec-model" => recognition_model = Some(PathBuf::from(value(&mut args, "--rec-model")?)),
            "--charset" => charset = Some(PathBuf::from(value(&mut args, "--charset")?)),
            "--expect" => expected_terms.push(value(&mut args, "--expect")?),
            "--minimum-expectations" => {
                minimum_expected_terms = value(&mut args, "--minimum-expectations")?
                    .parse()
                    .map_err(|_| "--minimum-expectations must be an integer".to_owned())?;
            }
            "--max-side" => {
                max_side = value(&mut args, "--max-side")?
                    .parse()
                    .map_err(|_| "--max-side must be an integer".to_owned())?;
            }
            "--max-cold-seconds" => {
                max_cold_seconds = value(&mut args, "--max-cold-seconds")?
                    .parse()
                    .map_err(|_| "--max-cold-seconds must be a number".to_owned())?;
            }
            "--max-warm-seconds" => {
                max_warm_seconds = value(&mut args, "--max-warm-seconds")?
                    .parse()
                    .map_err(|_| "--max-warm-seconds must be a number".to_owned())?;
            }
            "--help" | "-h" => {
                return Err(
                    "usage: ocr-native-spike --image <png> [--image <png>] --det-model <mnn> --rec-model <mnn> --charset <txt> [--expect <text>] [--minimum-expectations <n>] [--max-side 1600] [--max-cold-seconds 30] [--max-warm-seconds 15]".into(),
                );
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    if images.is_empty() {
        return Err("at least one --image is required".into());
    }
    if minimum_expected_terms > expected_terms.len() && !expected_terms.is_empty() {
        return Err("--minimum-expectations exceeds the number of --expect terms".into());
    }
    Ok(Args {
        images,
        detection_model: detection_model.ok_or("missing --det-model")?,
        recognition_model: recognition_model.ok_or("missing --rec-model")?,
        charset: charset.ok_or("missing --charset")?,
        expected_terms,
        minimum_expected_terms,
        max_side,
        max_cold_seconds,
        max_warm_seconds,
    })
}

fn bounded_image(image: DynamicImage, max_side: u32) -> DynamicImage {
    if max_side == 0 || image.width().max(image.height()) <= max_side {
        return image;
    }
    image.resize(max_side, max_side, image::imageops::FilterType::Lanczos3)
}

fn run() -> Result<(SpikeReport, bool), Box<dyn std::error::Error>> {
    let args = parse_args()?;
    for path in [
        &args.detection_model,
        &args.recognition_model,
        &args.charset,
    ]
    .into_iter()
    .chain(args.images.iter())
    {
        if !path.is_file() {
            return Err(format!("required file does not exist: {}", path.display()).into());
        }
    }

    let logical_processors = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4);
    let threads = (logical_processors / 2).clamp(2, 8) as i32;
    let config = OcrEngineConfig::fast().with_threads(threads);

    let engine_started = Instant::now();
    let engine = OcrEngine::new(
        &args.detection_model,
        &args.recognition_model,
        &args.charset,
        Some(config),
    )?;
    let engine_initialization_ms = engine_started.elapsed().as_millis();

    let mut failures = Vec::new();
    let mut runs = Vec::new();
    for (index, image_path) in args.images.iter().enumerate() {
        let run_started = Instant::now();
        let decode_started = Instant::now();
        let original = image::open(image_path)?;
        let original_width = original.width();
        let original_height = original.height();
        let working = bounded_image(original, args.max_side);
        let image_decode_ms = decode_started.elapsed().as_millis();

        let recognition_started = Instant::now();
        let results = engine.recognize(&working)?;
        let recognition_ms = recognition_started.elapsed().as_millis();
        let items = results
            .into_iter()
            .map(|item| RecognizedItem {
                text: item.text,
                confidence: item.confidence,
                bounds_debug: format!("{:?}", item.bbox),
            })
            .collect::<Vec<_>>();
        let combined_text = items
            .iter()
            .map(|item| item.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let matched_expected_terms = args
            .expected_terms
            .iter()
            .filter(|term| combined_text.contains(term.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        let run_total_ms = run_started.elapsed().as_millis();

        if items.is_empty() {
            failures.push(format!("run {} returned no text", index + 1));
        }
        if !args.expected_terms.is_empty()
            && matched_expected_terms.len() < args.minimum_expected_terms
        {
            failures.push(format!(
                "run {} matched only {}/{} required timetable terms",
                index + 1,
                matched_expected_terms.len(),
                args.minimum_expected_terms
            ));
        }
        if index > 0 && run_total_ms as f64 > args.max_warm_seconds * 1000.0 {
            failures.push(format!(
                "warm run {} took {} ms, limit is {:.0} ms",
                index + 1,
                run_total_ms,
                args.max_warm_seconds * 1000.0
            ));
        }

        runs.push(RecognitionRun {
            image_name: image_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("image")
                .to_owned(),
            original_width,
            original_height,
            working_width: working.width(),
            working_height: working.height(),
            image_decode_ms,
            recognition_ms,
            run_total_ms,
            matched_expected_terms,
            item_count: items.len(),
            items,
        });
    }

    let first_run_ms = runs.first().map(|run| run.run_total_ms).unwrap_or_default();
    let cold_total_ms = engine_initialization_ms + first_run_ms;
    if cold_total_ms as f64 > args.max_cold_seconds * 1000.0 {
        failures.push(format!(
            "cold end-to-end run took {cold_total_ms} ms, limit is {:.0} ms",
            args.max_cold_seconds * 1000.0
        ));
    }

    let passed = failures.is_empty();
    Ok((
        SpikeReport {
            engine: "ocr-rs/MNN in-process",
            external_processes: 0,
            engine_initialization_ms,
            cold_total_ms,
            warm_run_limit_ms: (args.max_warm_seconds * 1000.0) as u128,
            cold_run_limit_ms: (args.max_cold_seconds * 1000.0) as u128,
            all_gates_passed: passed,
            failures,
            runs,
        },
        passed,
    ))
}

fn main() -> ExitCode {
    match run() {
        Ok((report, passed)) => {
            match serde_json::to_string_pretty(&report) {
                Ok(json) => println!("{json}"),
                Err(error) => {
                    eprintln!("could not serialize spike report: {error}");
                    return ExitCode::from(2);
                }
            }
            if passed {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(3)
            }
        }
        Err(error) => {
            eprintln!("native OCR spike failed: {error}");
            ExitCode::from(1)
        }
    }
}
