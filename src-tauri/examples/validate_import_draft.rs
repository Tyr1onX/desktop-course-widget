#[path = "../src/excel_import/types.rs"]
mod excel_import_types;

mod excel_import {
    pub mod types {
        pub use crate::excel_import_types::*;
    }
}

#[path = "../src/import_draft.rs"]
mod import_draft;

use std::{env, fs, process};

use import_draft::{ImportDraft, ImportIssueSeverity, ImportReviewStatus};
use serde_json::json;

fn main() {
    let Some(path) = env::args().nth(1) else {
        eprintln!("usage: validate_import_draft <draft.json>");
        process::exit(2);
    };
    let bytes = match fs::read(&path) {
        Ok(value) => value,
        Err(error) => fail(format!("无法读取草稿：{error}")),
    };
    let draft: ImportDraft = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => fail(format!("ImportDraft 反序列化失败：{error}")),
    };
    let strict_result = draft.validate();
    let issues = draft.issues();
    let has_error = issues.iter().any(|issue| issue.severity == ImportIssueSeverity::Error);
    let has_review = issues.iter().any(|issue| issue.severity == ImportIssueSeverity::Review);

    let mut acknowledged = draft.clone();
    for evidence in acknowledged
        .courses
        .iter_mut()
        .filter_map(|course| course.review.as_mut())
        .flat_map(|review| review.fields.iter_mut())
    {
        evidence.status = ImportReviewStatus::Confirmed;
    }
    let structural_result = acknowledged.validate();
    let structural_valid = structural_result.is_ok() && !has_error;
    let payload = json!({
        "strictValid": strict_result.is_ok(),
        "structuralValid": structural_valid,
        "reviewOnly": !has_error && has_review,
        "strictError": strict_result.err(),
        "structuralError": structural_result.err(),
        "issueCount": issues.len(),
        "issues": issues,
    });
    println!("{}", serde_json::to_string(&payload).unwrap());
    if !structural_valid {
        process::exit(1);
    }
}

fn fail(message: String) -> ! {
    println!("{}", json!({"error": message}));
    process::exit(1);
}
