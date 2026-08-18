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

    #[test]
    fn title_geometry_beats_a_schedule_box_shifted_into_the_previous_column() {
        let tokens = vec![
            token("单片机原理及其应用[04]", 480.0, 100.0, 170.0, 22.0),
            token("刘聪", 480.0, 126.0, 48.0, 22.0),
            token("南湖-第1教学楼-三阶", 480.0, 148.0, 150.0, 22.0),
            // The OCR schedule bbox is shifted left far enough that its center belongs
            // to Tuesday. The local card title and fields are still clearly in Wednesday.
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
            // A neighbouring Tuesday card can be vertically closer to a shifted
            // schedule box than the real Wednesday title. One title token must not
            // decide the whole card column by itself.
            token("相邻课程[02]", 300.0, 124.0, 150.0, 22.0),
            token("单片机原理及其应用[04]", 480.0, 100.0, 170.0, 22.0),
            token("刘聪", 490.0, 126.0, 48.0, 22.0),
            token("南湖-第1教学楼-三阶", 480.0, 180.0, 150.0, 22.0),
            // Real-A shape: OCR text says Tuesday and the schedule bbox center also
            // lands in Tuesday, while the title/teacher/location cluster is Wednesday.
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
    fn adjustment_annotation_does_not_spawn_a_duplicate_course_card() {
        let tokens = vec![
            token("现代管理科学基础", 660.0, 100.0, 150.0, 22.0),
            token("刘宁", 660.0, 126.0, 48.0, 22.0),
            token("周四第8-9节1周", 660.0, 154.0, 160.0, 22.0),
            token("教3-309", 660.0, 180.0, 90.0, 22.0),
            // A nearby ordinary-looking title makes the second schedule anchor capable
            // of borrowing a clean name unless the auxiliary card is rejected first.
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
    fn truncated_adjustment_markers_are_classified_as_auxiliary_text() {
        assert!(is_auxiliary_course_annotation("（调0006现代管理科学基础"));
        assert!(is_auxiliary_course_annotation("(停1234)概率论"));
        assert!(!is_auxiliary_course_annotation("调音基础"));
        assert!(!is_auxiliary_course_annotation("现代管理科学基础"));
    }
}
