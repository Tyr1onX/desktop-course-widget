use std::{env, path::PathBuf, time::Instant};

use ocr_rs::OcrEngine;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecognizedItem {
    text: String,
    confidence: f32,
    bounds_debug: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpikeReport {
    engine_initialization_ms: u128,
    image_decode_ms: u128,
    recognition_ms: u128,
    total_ms: u128,
    item_count: usize,
    items: Vec<RecognizedItem>,
}

fn required_path(args: &mut impl Iterator<Item = String>, name: &str) -> Result<PathBuf, String> {
    args.next()
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: {name}"))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let total_started = Instant::now();
    let mut args = env::args().skip(1);
    let image_path = required_path(&mut args, "image")?;
    let detection_model = required_path(&mut args, "detection model")?;
    let recognition_model = required_path(&mut args, "recognition model")?;
    let charset = required_path(&mut args, "character set")?;
    if args.next().is_some() {
        return Err("unexpected extra arguments".into());
    }

    for path in [&image_path, &detection_model, &recognition_model, &charset] {
        if !path.is_file() {
            return Err(format!("required file does not exist: {}", path.display()).into());
        }
    }

    let engine_started = Instant::now();
    let engine = OcrEngine::new(&detection_model, &recognition_model, &charset, None)?;
    let engine_initialization_ms = engine_started.elapsed().as_millis();

    let image_started = Instant::now();
    let image = image::open(&image_path)?;
    let image_decode_ms = image_started.elapsed().as_millis();

    let recognition_started = Instant::now();
    let results = engine.recognize(&image)?;
    let recognition_ms = recognition_started.elapsed().as_millis();

    let items = results
        .into_iter()
        .map(|item| RecognizedItem {
            text: item.text,
            confidence: item.confidence,
            bounds_debug: format!("{:?}", item.bbox),
        })
        .collect::<Vec<_>>();
    let report = SpikeReport {
        engine_initialization_ms,
        image_decode_ms,
        recognition_ms,
        total_ms: total_started.elapsed().as_millis(),
        item_count: items.len(),
        items,
    };
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
