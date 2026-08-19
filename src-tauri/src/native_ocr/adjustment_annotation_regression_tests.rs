#[cfg(test)]
mod adjustment_annotation_regression_tests {
    use super::*;

    fn token(text: &str, left: f32, top: f32, width: f32, height: f32) -> Token {
        Token::from_text(text, 0.98, left, top, width, height).unwrap()
    }

    fn headers() -> Vec<WeekdayHeader> {
        (1..=6)
            .map(|weekday| WeekdayHeader {
                weekday,
                center_x: 180.0 + (weekday as f32 - 1.0) * 180.0,
                bottom: 80.0,
            })
            .collect()
    }

    #[test]
    fn nearby_adjustment_marker_does_not_drop_the_real_arrangement() {
        let tokens = vec![
            token("现代管理科学基础", 660.0, 100.0, 150.0, 22.0),
            token("刘宁", 660.0, 126.0, 48.0, 22.0),
            token("周四第8-9节3-17周", 660.0, 154.0, 170.0, 22.0),
            token("教3-309", 660.0, 180.0, 90.0, 22.0),
            token("（调0006）", 660.0, 206.0, 90.0, 22.0),
        ];
        let anchors = structured_course_anchors(&tokens);
        let parsed = anchor_courses(&tokens, &anchors, &headers(), 1260, 700).0;

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "现代管理科学基础");
        assert_eq!(parsed[0].teacher.as_deref(), Some("刘宁"));
        assert_eq!(parsed[0].location.as_deref(), Some("教3-309"));
        assert_eq!((parsed[0].weekday, parsed[0].start_section, parsed[0].end_section), (4, 8, 9));
        assert_eq!(parsed[0].weeks, (3..=17).collect::<Vec<_>>());
    }

    #[test]
    fn nearby_stop_marker_does_not_drop_the_real_arrangement() {
        let tokens = vec![
            token("操作系统基础（混合式）", 840.0, 100.0, 180.0, 22.0),
            token("吴晓诗", 840.0, 126.0, 60.0, 22.0),
            token("周五第3-4节第2周", 840.0, 154.0, 160.0, 22.0),
            token("教3-201", 840.0, 180.0, 90.0, 22.0),
            token("（停0079）", 840.0, 206.0, 90.0, 22.0),
        ];
        let anchors = structured_course_anchors(&tokens);
        let parsed = anchor_courses(&tokens, &anchors, &headers(), 1260, 700).0;

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "操作系统基础（混合式）");
        assert_eq!(parsed[0].teacher.as_deref(), Some("吴晓诗"));
        assert_eq!(parsed[0].location.as_deref(), Some("教3-201"));
        assert_eq!((parsed[0].weekday, parsed[0].start_section, parsed[0].end_section), (5, 3, 4));
        assert_eq!(parsed[0].weeks, vec![2]);
    }

    fn course(name: &str) -> ImportCourse {
        ImportCourse {
            code: None,
            name: name.into(),
            teacher: None,
            weekday: 1,
            start_section: 1,
            end_section: 2,
            weeks: (1..=17).collect(),
            parity: "all".into(),
            location: None,
            review: None,
        }
    }

    #[test]
    fn unique_full_sibling_completes_a_truncated_mixed_title() {
        let mut courses = vec![
            course("计算机系统基础（混合式）"),
            course("计算机系统基础（混"),
            course("操作系统基础（混合式）"),
            course("操作系统基础（混合"),
        ];

        assert_eq!(complete_unique_truncated_course_names(&mut courses), 2);
        assert_eq!(courses[1].name, "计算机系统基础（混合式）");
        assert_eq!(courses[3].name, "操作系统基础（混合式）");
    }
}
