use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ParsedWorkbook {
    pub detected_term_text: Option<String>,
    pub scheduled_entries: Vec<ParsedCourseEntry>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedCourseEntry {
    pub code: Option<String>,
    pub name: String,
    pub weekday: u8,
    pub start_section: u8,
    pub end_section: u8,
    pub weeks: Vec<u8>,
    pub parity: String,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SectionTime {
    pub section: u8,
    pub start: String,
    pub end: String,
}

/// Privacy-safe diagnostics for local XLSX parser audits. This intentionally
/// excludes all raw workbook text and personal information.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ParseAudit {
    pub worksheet_count: usize,
    pub original_candidates: usize,
    pub successful_parses: usize,
    pub exact_duplicates: usize,
    pub outside_schedule_grid: usize,
    pub final_valid_entries: usize,
    pub legacy_candidates: Vec<AuditEntry>,
    pub entries: Vec<AuditEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditEntry {
    pub worksheet_index: usize,
    pub row: usize,
    pub column: usize,
    pub weekday: u8,
    pub start_section: u8,
    pub end_section: u8,
    pub weeks: Vec<u8>,
    pub parity: String,
    pub location_is_empty: bool,
    pub location_fingerprint: String,
    pub course_fingerprint: String,
}
