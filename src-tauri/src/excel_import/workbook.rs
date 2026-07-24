use super::{
    parser::parse_cell,
    types::{AuditEntry, ParseAudit, ParsedCourseEntry, ParsedWorkbook},
};
use calamine::{open_workbook_auto, Data, Reader};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::Path};

#[derive(Clone, Copy)]
struct Grid {
    header_row: usize,
    first_row: usize,
    last_row: usize,
    first_column: usize,
    last_column: usize,
    section_column: usize,
}

#[derive(Clone)]
struct SourcedEntry {
    entry: ParsedCourseEntry,
    worksheet_index: usize,
    row: usize,
    column: usize,
}

pub fn parse_xlsx(path: &Path) -> Result<ParsedWorkbook, String> {
    let (entries, warnings, _) = constrained_entries(path)?;
    let entries = deduplicate(entries);
    if entries.is_empty() {
        return Err("未识别到已排课程".into());
    }
    Ok(ParsedWorkbook {
        detected_term_text: None,
        scheduled_entries: entries.into_iter().map(|item| item.entry).collect(),
        warnings,
    })
}

/// Produces privacy-safe, aggregate parser diagnostics.  The returned entries
/// carry coordinates and fingerprints only; never raw workbook text.
pub fn audit_xlsx(path: &Path) -> Result<ParseAudit, String> {
    let (constrained, _, worksheet_count) = constrained_entries(path)?;
    let legacy = legacy_entries(path)?;
    let successful_parses = constrained.len();
    let final_entries = deduplicate(constrained);
    let allowed_sources = final_entries
        .iter()
        .map(source_coordinate)
        .collect::<HashSet<_>>();
    let outside_schedule_grid = legacy
        .iter()
        .filter(|item| !allowed_sources.contains(&source_coordinate(item)))
        .count();
    let exact_duplicates = legacy
        .len()
        .saturating_sub(deduplicate(legacy.clone()).len());

    Ok(ParseAudit {
        worksheet_count,
        original_candidates: legacy.len(),
        successful_parses,
        exact_duplicates,
        outside_schedule_grid,
        final_valid_entries: final_entries.len(),
        legacy_candidates: legacy.iter().map(to_audit_entry).collect(),
        entries: final_entries.iter().map(to_audit_entry).collect(),
    })
}

pub fn workbook_sheet_count(path: &Path) -> Result<usize, String> {
    ensure_xlsx(path)?;
    let workbook =
        open_workbook_auto(path).map_err(|error| format!("无法打开 Excel 工作簿：{error}"))?;
    Ok(workbook.sheet_names().len())
}

fn constrained_entries(path: &Path) -> Result<(Vec<SourcedEntry>, Vec<String>, usize), String> {
    ensure_xlsx(path)?;
    let mut workbook = open_workbook_auto(path).map_err(|_| "无法打开 XLSX 文件".to_owned())?;
    let sheet_names = workbook.sheet_names().to_owned();
    let mut entries = Vec::new();
    let mut warnings = Vec::new();

    for (worksheet_index, sheet_name) in sheet_names.iter().enumerate() {
        let range = workbook
            .worksheet_range(sheet_name)
            .map_err(|_| "无法读取课表工作表".to_owned())?;
        let rows = range.rows().collect::<Vec<_>>();
        let mut accepted_grid_signatures = HashSet::new();

        for grid in find_grids(&rows) {
            let grid_entries = scan_grid(&rows, grid, worksheet_index, &mut warnings);
            if grid_entries.is_empty() {
                continue;
            }
            let signature = grid_entries.iter().map(arrangement_key).collect::<Vec<_>>();
            if accepted_grid_signatures.insert(signature) {
                entries.extend(grid_entries);
            }
        }
    }

    Ok((entries, warnings, sheet_names.len()))
}

/// Recreates the pre-fix broad scan strictly for local audit comparison. It is
/// never used by `parse_xlsx`, so outside-grid cells cannot reach production.
fn legacy_entries(path: &Path) -> Result<Vec<SourcedEntry>, String> {
    ensure_xlsx(path)?;
    let mut workbook = open_workbook_auto(path).map_err(|_| "无法打开 XLSX 文件".to_owned())?;
    let sheet_names = workbook.sheet_names().to_owned();
    let mut entries = Vec::new();
    for (worksheet_index, sheet_name) in sheet_names.iter().enumerate() {
        let range = workbook
            .worksheet_range(sheet_name)
            .map_err(|_| "无法读取课表工作表".to_owned())?;
        let rows = range.rows().collect::<Vec<_>>();
        for (header_row, row) in rows.iter().enumerate() {
            let days = legacy_weekday_columns(row);
            if days.is_empty() {
                continue;
            }
            for source_row in header_row + 1..rows.len() {
                let sections = section(rows[source_row].first().map(cell).unwrap_or(""));
                if sections.is_none() && source_row > header_row + 40 {
                    break;
                }
                for (column, weekday) in &days {
                    let value = rows[source_row].get(*column).map(cell).unwrap_or("");
                    if let Ok(parsed) = parse_cell(value, *weekday, sections) {
                        // The pre-fix parser only kept the first matching week
                        // clause from a cell. Keep that behavior here so this
                        // audit can faithfully explain the historical count.
                        entries.extend(parsed.into_iter().take(1).map(|entry| SourcedEntry {
                            entry,
                            worksheet_index,
                            row: source_row + 1,
                            column: column + 1,
                        }));
                    }
                }
            }
        }
    }
    Ok(entries)
}

fn find_grids(rows: &[&[Data]]) -> Vec<Grid> {
    let mut grids = Vec::new();
    for (header_row, row) in rows.iter().enumerate() {
        let days = weekday_columns(row);
        if days.len() < 5 {
            continue;
        }
        let first_column = days.first().map(|(column, _)| *column).unwrap_or(0);
        let last_column = days.last().map(|(column, _)| *column).unwrap_or(0);
        let Some(section_column) = find_section_column(rows, header_row, first_column) else {
            continue;
        };
        let Some((first_row, last_row)) = section_row_span(rows, header_row, section_column) else {
            continue;
        };
        grids.push(Grid {
            header_row,
            first_row,
            last_row,
            first_column,
            last_column,
            section_column,
        });
    }
    grids
}

fn find_section_column(
    rows: &[&[Data]],
    header_row: usize,
    first_day_column: usize,
) -> Option<usize> {
    (0..first_day_column)
        .map(|column| {
            let score = rows
                .iter()
                .skip(header_row + 1)
                .take(30)
                .filter(|row| section(row.get(column).map(cell).unwrap_or("")).is_some())
                .count();
            (column, score)
        })
        .max_by_key(|(_, score)| *score)
        .filter(|(_, score)| *score >= 2)
        .map(|(column, _)| column)
}

fn section_row_span(
    rows: &[&[Data]],
    header_row: usize,
    section_column: usize,
) -> Option<(usize, usize)> {
    let mut first = None;
    let mut last = None;
    let mut gaps = 0;
    for row_index in header_row + 1..rows.len().min(header_row + 31) {
        if section(rows[row_index].get(section_column).map(cell).unwrap_or("")).is_some() {
            first.get_or_insert(row_index);
            last = Some(row_index);
            gaps = 0;
        } else if first.is_some() {
            gaps += 1;
            // Exporters commonly use vertically merged course cells. Their
            // section labels can therefore be separated by several physical
            // rows; eight empty rows ends the grid without reaching a later
            // notes/list area.
            if gaps >= 8 {
                break;
            }
        }
    }
    first.zip(last)
}

fn scan_grid(
    rows: &[&[Data]],
    grid: Grid,
    worksheet_index: usize,
    warnings: &mut Vec<String>,
) -> Vec<SourcedEntry> {
    let days = weekday_columns(rows[grid.header_row]);
    let mut entries = Vec::new();
    for row_index in grid.first_row..=grid.last_row {
        let Some(sections) = section(
            rows[row_index]
                .get(grid.section_column)
                .map(cell)
                .unwrap_or(""),
        ) else {
            continue;
        };
        for (column, weekday) in days
            .iter()
            .filter(|(column, _)| *column >= grid.first_column && *column <= grid.last_column)
        {
            let value = rows[row_index].get(*column).map(cell).unwrap_or("");
            match parse_cell(value, *weekday, Some(sections)) {
                Ok(parsed) => entries.extend(parsed.into_iter().map(|entry| SourcedEntry {
                    entry,
                    worksheet_index,
                    row: row_index + 1,
                    column: column + 1,
                })),
                Err(_) if !value.trim().is_empty() => {
                    warnings.push(format!("课表网格安排 {} 无法可靠解析", warnings.len() + 1))
                }
                Err(_) => {}
            }
        }
    }
    entries
}

fn deduplicate(entries: Vec<SourcedEntry>) -> Vec<SourcedEntry> {
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter(|item| seen.insert(arrangement_key(item)))
        .collect()
}

fn arrangement_key(item: &SourcedEntry) -> String {
    let entry = &item.entry;
    format!(
        "{}|{}|{}|{}|{:?}|{}|{}",
        normalized(entry.code.as_deref().unwrap_or(&entry.name)),
        entry.weekday,
        entry.start_section,
        entry.end_section,
        entry.weeks,
        entry.parity,
        normalized(entry.location.as_deref().unwrap_or("")),
    )
}

fn source_coordinate(item: &SourcedEntry) -> (usize, usize, usize) {
    (item.worksheet_index, item.row, item.column)
}

fn to_audit_entry(item: &SourcedEntry) -> AuditEntry {
    let entry = &item.entry;
    AuditEntry {
        worksheet_index: item.worksheet_index,
        row: item.row,
        column: item.column,
        weekday: entry.weekday,
        start_section: entry.start_section,
        end_section: entry.end_section,
        weeks: entry.weeks.clone(),
        parity: entry.parity.clone(),
        location_is_empty: entry.location.as_deref().unwrap_or("").is_empty(),
        location_fingerprint: short_hash(&normalized(entry.location.as_deref().unwrap_or(""))),
        course_fingerprint: short_hash(&normalized(entry.name.as_str())),
    }
}

fn weekday_columns(row: &[Data]) -> Vec<(usize, u8)> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    for (column, value) in row.iter().enumerate() {
        if let Some(day) = weekday(cell(value)) {
            if seen.insert(day) {
                found.push((column, day));
            }
        }
    }
    found
}

fn legacy_weekday_columns(row: &[Data]) -> Vec<(usize, u8)> {
    row.iter()
        .enumerate()
        .filter_map(|(column, value)| legacy_weekday(cell(value)).map(|day| (column, day)))
        .collect()
}

fn cell(value: &Data) -> &str {
    match value {
        Data::String(value) => value,
        Data::Empty => "",
        _ => "",
    }
}

fn weekday(value: &str) -> Option<u8> {
    if !value.contains("星期") {
        return None;
    }
    [
        ("一", 1),
        ("二", 2),
        ("三", 3),
        ("四", 4),
        ("五", 5),
        ("六", 6),
        ("日", 7),
        ("天", 7),
    ]
    .iter()
    .find_map(|(needle, day)| value.contains(needle).then_some(*day))
}

fn legacy_weekday(value: &str) -> Option<u8> {
    [
        ("一", 1),
        ("二", 2),
        ("三", 3),
        ("四", 4),
        ("五", 5),
        ("六", 6),
        ("日", 7),
        ("天", 7),
    ]
    .iter()
    .find_map(|(needle, day)| value.contains(needle).then_some(*day))
}

fn section(value: &str) -> Option<(u8, u8)> {
    let numbers = value
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u8>().ok())
        .collect::<Vec<_>>();
    match numbers.as_slice() {
        [single] if *single > 0 => Some((*single, *single)),
        [start, end, ..] if *start > 0 && *end >= *start => Some((*start, *end)),
        _ => None,
    }
}

fn normalized(value: &str) -> String {
    value.split_whitespace().collect::<String>().to_lowercase()
}

fn short_hash(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn ensure_xlsx(path: &Path) -> Result<(), String> {
    if path.extension().and_then(|extension| extension.to_str()) == Some("xlsx") {
        Ok(())
    } else {
        Err("当前版本仅支持 .xlsx 文件".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sourced(weekday: u8, weeks: Vec<u8>) -> SourcedEntry {
        SourcedEntry {
            entry: ParsedCourseEntry {
                code: Some("C001".into()),
                name: "Anonymous course".into(),
                weekday,
                start_section: 1,
                end_section: 2,
                weeks,
                parity: "all".into(),
                location: Some("Building A101".into()),
            },
            worksheet_index: 0,
            row: 1,
            column: 1,
        }
    }

    #[test]
    fn deduplicates_only_identical_arrangements() {
        let same = sourced(1, vec![1, 2]);
        let different_weeks = sourced(1, vec![3, 4]);
        let different_day = sourced(2, vec![1, 2]);
        assert_eq!(
            deduplicate(vec![same.clone(), same, different_weeks, different_day]).len(),
            3
        );
    }

    #[test]
    fn grid_detection_requires_a_full_weekday_header() {
        let rows = vec![
            vec![Data::String("notes 星期1".into())],
            vec![
                Data::String("节次".into()),
                Data::String("星期一".into()),
                Data::String("星期二".into()),
                Data::String("星期三".into()),
                Data::String("星期四".into()),
                Data::String("星期五".into()),
            ],
            vec![
                Data::String("第1节-第2节".into()),
                Data::Empty,
                Data::Empty,
                Data::Empty,
                Data::Empty,
                Data::Empty,
            ],
            vec![
                Data::String("第3节-第4节".into()),
                Data::Empty,
                Data::Empty,
                Data::Empty,
                Data::Empty,
                Data::Empty,
            ],
        ];
        let borrowed = rows.iter().map(Vec::as_slice).collect::<Vec<_>>();
        let grids = find_grids(&borrowed);
        assert_eq!(grids.len(), 1);
        assert_eq!(grids[0].header_row, 1);
    }
}
