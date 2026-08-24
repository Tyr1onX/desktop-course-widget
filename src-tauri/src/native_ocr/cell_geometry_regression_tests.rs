#[cfg(test)]
mod cell_geometry_regression_tests {
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

    fn courses(tokens: &[Token]) -> Vec<ImportCourse> {
        let anchors = structured_course_anchors(tokens);
        anchor_courses(tokens, &anchors, &headers(), 1260, 760).0
    }

    fn course(
        name: &str,
        teacher: &str,
        weekday: u8,
        weeks: Vec<u8>,
        location: Option<&str>,
    ) -> ImportCourse {
        ImportCourse {
            code: None,
            name: name.into(),
            teacher: Some(teacher.into()),
            weekday,
            start_section: 1,
            end_section: 2,
            weeks,
            parity: "all".into(),
            location: location.map(str::to_owned),
            review: None,
        }
    }

    #[test]
    fn title_geometry_beats_a_schedule_box_shifted_into_the_previous_column() {
        let tokens = vec![
            token("单片机原理及其应用[04]", 480.0, 100.0, 170.0, 22.0),
            token("刘聪", 480.0, 126.0, 48.0, 22.0),
            token("南湖-第1教学楼-三阶", 480.0, 148.0, 150.0, 22.0),
            token("周二第5-6节6-13周", 365.0, 154.0, 160.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "单片机原理及其应用[04]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("刘聪"));
        assert_eq!(parsed[0].location.as_deref(), Some("南湖-第1教学楼-三阶"));
        assert_eq!(
            (parsed[0].weekday, parsed[0].start_section, parsed[0].end_section),
            (3, 5, 6)
        );
    }

    #[test]
    fn local_field_cluster_beats_a_nearer_wrong_column_title() {
        let tokens = vec![
            token("相邻课程[02]", 300.0, 124.0, 150.0, 22.0),
            token("单片机原理及其应用[04]", 480.0, 100.0, 170.0, 22.0),
            token("刘聪", 490.0, 126.0, 48.0, 22.0),
            token("南湖-第1教学楼-三阶", 480.0, 180.0, 150.0, 22.0),
            token("周二第1-2节6-13周", 340.0, 154.0, 180.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "单片机原理及其应用[04]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("刘聪"));
        assert_eq!(parsed[0].location.as_deref(), Some("南湖-第1教学楼-三阶"));
        assert_eq!(
            (parsed[0].weekday, parsed[0].start_section, parsed[0].end_section),
            (3, 1, 2)
        );
        assert_eq!(parsed[0].weeks, (6..=13).collect::<Vec<_>>());
    }

    #[test]
    fn coded_sibling_arrangement_inherits_the_only_consistent_location() {
        let tokens = vec![
            token("单片机原理及其应用[04]", 110.0, 100.0, 150.0, 22.0),
            token("刘聪", 120.0, 126.0, 48.0, 22.0),
            token("南湖-第1教学楼-三阶", 110.0, 150.0, 150.0, 22.0),
            token("周一第5-6节6-13周", 110.0, 176.0, 160.0, 22.0),
            token("单片机原理及其应用[04]", 470.0, 100.0, 150.0, 22.0),
            token("刘聪", 480.0, 126.0, 48.0, 22.0),
            token("周三第1-2节6-13周", 470.0, 176.0, 160.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].location.as_deref(), Some("南湖-第1教学楼-三阶"));
        assert_eq!(parsed[1].location.as_deref(), Some("南湖-第1教学楼-三阶"));
    }

    #[test]
    fn unique_coded_course_location_can_cross_teacher_and_week_segments() {
        let mut parsed = vec![
            course(
                "通信与网络[03]",
                "李启豪",
                1,
                (3..=8).collect(),
                Some("南湖-第1教学楼-四阶"),
            ),
            course(
                "通信与网络[03]",
                "李启豪",
                3,
                (3..=8).collect(),
                None,
            ),
            course(
                "通信与网络[03]",
                "顾海军",
                3,
                (9..=14).collect(),
                None,
            ),
        ];
        assert_eq!(fill_unique_coded_course_locations(&mut parsed), 2);
        assert!(parsed
            .iter()
            .all(|item| item.location.as_deref() == Some("南湖-第1教学楼-四阶")));
    }

    #[test]
    fn conflicting_locations_are_never_propagated() {
        let mut parsed = vec![
            course("某课程[01]", "甲", 1, vec![1], Some("教1-101")),
            course("某课程[01]", "甲", 2, vec![1], Some("教1-102")),
            course("某课程[01]", "甲", 3, vec![1], None),
        ];
        assert_eq!(fill_unique_coded_course_locations(&mut parsed), 0);
        assert_eq!(parsed[2].location, None);
    }

    #[test]
    fn overlapping_week_fragment_from_same_course_card_keeps_full_range() {
        let tokens = vec![
            token("现代管理科学基础", 660.0, 100.0, 150.0, 22.0),
            token("刘宁", 660.0, 126.0, 48.0, 22.0),
            token("周四第8-9节1周", 660.0, 154.0, 160.0, 22.0),
            token("周四第8-9节1-17周", 662.0, 156.0, 174.0, 22.0),
            token("教3-309", 660.0, 184.0, 90.0, 22.0),
        ];
        let anchors = structured_course_anchors(&tokens);
        assert!(anchors.len() >= 2);
        let parsed = anchor_courses(&tokens, &anchors, &headers(), 1260, 760).0;
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "现代管理科学基础");
        assert_eq!(parsed[0].teacher.as_deref(), Some("刘宁"));
        assert_eq!(parsed[0].location.as_deref(), Some("教3-309"));
        assert_eq!(
            (parsed[0].weekday, parsed[0].start_section, parsed[0].end_section),
            (4, 8, 9)
        );
        assert_eq!(parsed[0].weeks, (1..=17).collect::<Vec<_>>());
    }

    #[test]
    fn same_card_disjoint_week_segments_remain_separate_arrangements() {
        let tokens = vec![
            token("课程A", 660.0, 100.0, 120.0, 22.0),
            token("教师甲", 660.0, 126.0, 70.0, 22.0),
            token("周四第8-9节1-8周", 660.0, 154.0, 168.0, 22.0),
            token("周四第8-9节9-17周", 660.0, 184.0, 176.0, 22.0),
            token("教3-309", 660.0, 214.0, 90.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 2);
        let mut week_sets = parsed
            .iter()
            .map(|course| course.weeks.clone())
            .collect::<Vec<_>>();
        week_sets.sort();
        assert_eq!(
            week_sets,
            vec![(1..=8).collect::<Vec<_>>(), (9..=17).collect::<Vec<_>>()]
        );
    }

    #[test]
    fn same_card_odd_even_arrangements_remain_separate() {
        let tokens = vec![
            token("课程A", 660.0, 100.0, 120.0, 22.0),
            token("教师甲", 660.0, 126.0, 70.0, 22.0),
            token("周四第8-9节1-17周(单周)", 660.0, 154.0, 190.0, 22.0),
            token("周四第8-9节1-17周(双周)", 660.0, 184.0, 190.0, 22.0),
            token("教3-309", 660.0, 214.0, 90.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 2);
        let mut parities = parsed
            .iter()
            .map(|course| course.parity.as_str())
            .collect::<Vec<_>>();
        parities.sort();
        assert_eq!(parities, vec!["even", "odd"]);
    }

    #[test]
    fn distinct_cards_keep_split_weeks_teacher_and_location() {
        let tokens = vec![
            token("课程A", 660.0, 100.0, 120.0, 22.0),
            token("教师甲", 660.0, 126.0, 70.0, 22.0),
            token("周四第8-9节1-8周", 660.0, 154.0, 168.0, 22.0),
            token("教3-301", 660.0, 180.0, 90.0, 22.0),
            token("课程A", 660.0, 236.0, 120.0, 22.0),
            token("教师乙", 660.0, 262.0, 70.0, 22.0),
            token("周四第8-9节9-17周", 660.0, 290.0, 176.0, 22.0),
            token("教3-302", 660.0, 316.0, 90.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].teacher.as_deref(), Some("教师甲"));
        assert_eq!(parsed[0].location.as_deref(), Some("教3-301"));
        assert_eq!(parsed[0].weeks, (1..=8).collect::<Vec<_>>());
        assert_eq!(parsed[1].teacher.as_deref(), Some("教师乙"));
        assert_eq!(parsed[1].location.as_deref(), Some("教3-302"));
        assert_eq!(parsed[1].weeks, (9..=17).collect::<Vec<_>>());
    }

    #[test]
    fn adjustment_annotation_does_not_spawn_a_duplicate_course_card() {
        let tokens = vec![
            token("现代管理科学基础", 660.0, 100.0, 150.0, 22.0),
            token("刘宁", 660.0, 126.0, 48.0, 22.0),
            token("周四第8-9节1周", 660.0, 154.0, 160.0, 22.0),
            token("教3-309", 660.0, 180.0, 90.0, 22.0),
            token("现代管理科学基础", 660.0, 204.0, 150.0, 22.0),
            token("（调0006现代管理科学基础", 660.0, 228.0, 190.0, 22.0),
            token("周四第8-9节1-17周", 660.0, 254.0, 170.0, 22.0),
            token("教3-309", 660.0, 280.0, 90.0, 22.0),
        ];
        let anchors = structured_course_anchors(&tokens);
        assert_eq!(anchors.len(), 2);
        let parsed = anchor_courses(&tokens, &anchors, &headers(), 1260, 760).0;
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "现代管理科学基础");
        assert_eq!(parsed[0].teacher.as_deref(), Some("刘宁"));
        assert_eq!(parsed[0].location.as_deref(), Some("教3-309"));
        assert_eq!(parsed[0].weeks, vec![1]);
    }

    #[test]
    fn fuzzy_numbered_adjustment_duplicate_is_dropped_even_if_action_glyph_is_wrong() {
        let mut parsed = vec![
            course("现代管理科学基础", "刘宁", 4, vec![1], Some("教3-309")),
            course(
                "（阀0006现代管理科学基础",
                "刘宁",
                4,
                (1..=17).collect(),
                Some("教3-309"),
            ),
        ];
        assert_eq!(drop_auxiliary_duplicate_rows(&mut parsed), 1);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "现代管理科学基础");
        assert_eq!(
            auxiliary_base_course_name("（阀0006现代管理科学基础").as_deref(),
            Some("现代管理科学基础")
        );
    }

    #[test]
    fn standalone_truncated_adjustment_card_never_reaches_course_output() {
        let tokens = vec![
            token("（调0006现代管理科学基础", 660.0, 100.0, 190.0, 22.0),
            token("刘宁", 660.0, 126.0, 48.0, 22.0),
            token("周四第8-9节1-17周", 660.0, 154.0, 170.0, 22.0),
            token("教3-309", 660.0, 180.0, 90.0, 22.0),
        ];
        assert!(courses(&tokens).is_empty());
        assert!(looks_like_auxiliary_course_name("（调0006现代管理科学基础"));
        assert!(looks_like_auxiliary_course_name("(停1234)概率论"));
    }

    #[test]
    fn truncated_adjustment_markers_are_classified_as_auxiliary_text() {
        assert!(is_auxiliary_course_annotation("（调0006现代管理科学基础"));
        assert!(is_auxiliary_course_annotation("(停1234)概率论"));
        assert!(!is_auxiliary_course_annotation("调音基础"));
        assert!(!is_auxiliary_course_annotation("现代管理科学基础"));
    }
}
