pub mod converter;
pub mod parser;
pub mod types;
pub mod workbook;

#[cfg(test)]
mod tests {
    use super::{
        parser::{parse_cell, parse_weeks},
        workbook::{audit_xlsx, parse_xlsx, workbook_sheet_count},
    };
    use std::path::Path;

    #[test]
    fn parses_anonymous_cell_variants() {
        let entries = parse_cell(
            "程序设计基础\n1-8,10-16周,星期1,第1节-第2节\n教学楼A101",
            1,
            Some((1, 2)),
        )
        .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].weeks.len(), 15);
        assert_eq!(entries[0].location.as_deref(), Some("教学楼A101"));
        assert!(parse_cell("上课时间暂未确定的课程", 1, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn normalizes_week_ranges_lists_and_rejects_invalid_weeks() {
        assert_eq!(parse_weeks("1-8,10-16周").unwrap().len(), 15);
        assert_eq!(parse_weeks("1, 3, 5周").unwrap(), vec![1, 3, 5]);
        assert!(parse_weeks("0周").is_err());
        assert!(parse_weeks("9-3周").is_err());
    }

    #[test]
    fn preserves_multiple_valid_week_segments_in_one_cell() {
        let entries = parse_cell(
            "计算机网络\n1-4周,星期2,第3节-第4节\n5-8周\n教学楼A101",
            2,
            Some((3, 4)),
        )
        .unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].weeks, vec![1, 2, 3, 4]);
        assert_eq!(entries[1].weeks, vec![5, 6, 7, 8]);
    }

    #[test]
    fn parses_locations_after_each_section_description() {
        let attached = parse_cell(
            "计算机网络\n3-8周,星期1,第1节-第2节教学楼A101",
            1,
            Some((1, 2)),
        )
        .unwrap();
        assert_eq!(attached[0].location.as_deref(), Some("教学楼A101"));

        let multiple = parse_cell(
            "计算机网络\n1-4周,星期2,第3节-第4节 教学楼A101\n5-8周,星期2,第3节-第4节无,",
            2,
            Some((3, 4)),
        )
        .unwrap();
        assert_eq!(multiple.len(), 2);
        assert_eq!(multiple[0].location.as_deref(), Some("教学楼A101"));
        assert_eq!(multiple[1].location, None);
    }

    #[test]
    fn normalizes_location_lines_and_does_not_swallow_the_next_course() {
        let next_line = parse_cell(
            "高等数学\n2周,星期3,第1节-第2节\n  教学楼A101  ,",
            3,
            Some((1, 2)),
        )
        .unwrap();
        assert_eq!(
            next_line[0].location.as_deref(),
            Some("教学楼A101")
        );

        let no_location = parse_cell(
            "课程甲\n1-2周,星期1,第1节-第2节\nC002-课程乙\n3-4周,星期1,第1节-第2节实验楼B203",
            1,
            Some((1, 2)),
        )
        .unwrap();
        assert_eq!(no_location[0].location, None);
        assert_eq!(no_location[1].location.as_deref(), Some("实验楼B203"));
    }

    #[test]
    fn private_sample_opens_without_exposing_contents() {
        let path = Path::new("../samples/private_examples/我的课表.xlsx");
        if path.exists() {
            let sheet_count =
                workbook_sheet_count(path).expect("private sample should expose sheet count");
            let parsed = parse_xlsx(path).expect("private sample should parse");
            assert!(sheet_count > 0);
            assert!(!parsed.scheduled_entries.is_empty());
            eprintln!(
                "private sample parsed sheets={sheet_count} entries={}",
                parsed.scheduled_entries.len()
            );
        }
    }

    #[test]
    fn private_sample_audit_is_coordinate_and_fingerprint_only() {
        let path = Path::new("../samples/private_examples/我的课表.xlsx");
        if !path.exists() {
            return;
        }
        let audit = audit_xlsx(path).expect("private sample should audit");
        assert!(audit
            .entries
            .iter()
            .all(|entry| !entry.course_fingerprint.is_empty()));
        assert_eq!(audit.final_valid_entries, audit.entries.len());
        let output_path = Path::new("../samples/private_examples/xlsx-parse-audit.json");
        std::fs::write(output_path, serde_json::to_vec_pretty(&audit).unwrap())
            .expect("private audit should be writable");
        eprintln!(
            "private audit candidates={} parsed={} duplicates={} outside_grid={} final={}",
            audit.original_candidates,
            audit.successful_parses,
            audit.exact_duplicates,
            audit.outside_schedule_grid,
            audit.final_valid_entries
        );
    }
}
