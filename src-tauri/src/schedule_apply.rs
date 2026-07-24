use std::fs;

use tauri::AppHandle;

use crate::schedule_store::{self, Schedule};

pub fn apply_schedule(app: &AppHandle, schedule: &Schedule) -> Result<Vec<String>, String> {
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(schedule).map_err(|error| error.to_string())?
    )
    .into_bytes();
    let validation = schedule_store::validate_schedule(&serialized);
    let normalized = validation
        .normalized_schedule
        .ok_or_else(|| validation.errors.join("；"))?;
    let normalized_bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&normalized).map_err(|error| error.to_string())?
    )
    .into_bytes();

    let destination = schedule_store::ensure_schedule_storage(app)?;
    if destination.exists() {
        schedule_store::backup_current_schedule(app, &destination)?;
    }

    let temporary = destination.with_extension("json.tmp");
    fs::write(&temporary, &normalized_bytes).map_err(|error| error.to_string())?;
    let check = fs::read(&temporary).map_err(|error| error.to_string())?;
    if !schedule_store::validate_schedule(&check).valid {
        let _ = fs::remove_file(&temporary);
        return Err("临时课表校验失败".into());
    }
    if destination.exists() {
        fs::remove_file(&destination).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;

    Ok(validation.warnings)
}
