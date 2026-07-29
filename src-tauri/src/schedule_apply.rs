use tauri::AppHandle;

use crate::{
    data_transaction::{self, FileChange},
    schedule_store::{self, Schedule},
};

pub(crate) struct PreparedSchedule {
    pub(crate) bytes: Vec<u8>,
    pub(crate) warnings: Vec<String>,
}

pub(crate) fn prepare_schedule(schedule: &Schedule) -> Result<PreparedSchedule, String> {
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(schedule).map_err(|error| error.to_string())?
    )
    .into_bytes();
    let validation = schedule_store::validate_schedule(&serialized);
    let normalized = validation
        .normalized_schedule
        .ok_or_else(|| validation.errors.join("；"))?;
    let bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(&normalized).map_err(|error| error.to_string())?
    )
    .into_bytes();

    Ok(PreparedSchedule {
        bytes,
        warnings: validation.warnings,
    })
}

pub fn apply_schedule(app: &AppHandle, schedule: &Schedule) -> Result<Vec<String>, String> {
    let prepared = prepare_schedule(schedule)?;
    let destination = schedule_store::ensure_schedule_storage(app)?;
    if destination.exists() {
        schedule_store::backup_current_schedule(app, &destination)?;
    }
    data_transaction::commit(app, vec![FileChange::write(destination, prepared.bytes)])?;
    Ok(prepared.warnings)
}
