#[cfg(test)]
mod tests {
    use super::*;

    fn token(text: &str, left: f32, top: f32) -> Token {
        Token::from_text(text, 0.98, left, top, 100.0, 28.0).unwrap()
    }

    #[test]
    fn parses_anchor_weeks_and_parity() {
        let tokens = vec![token("周五第6节-第7节1-15周(单)", 900.0, 500.0)];
        let anchors = course_anchors(&tokens);
        assert_eq!(anchors.len(), 1);
        assert_eq!(anchors[0].weekday, 5);
        assert_eq!(anchors[0].start_section, 6);
        assert_eq!(anchors[0].end_section, 7);
        assert_eq!(anchors[0].parity, "odd");
        assert_eq!(anchors[0].weeks, vec![1, 3, 5, 7, 9, 11, 13, 15]);
    }

    #[test]
    fn parses_numeric_weekday_labels() {
        assert_eq!(weekday_from_text("星期1"), Some(1));
        assert_eq!(weekday_from_text("周6"), Some(6));
        assert_eq!(weekday_from_text("星期7"), Some(7));
    }

    #[test]
    fn parses_compact_section_and_time_labels() {
        assert_eq!(section_number_from_text("1"), Some(1));
        assert_eq!(section_number_from_text("第10节"), Some(10));
        assert_eq!(section_number_from_text("108:00"), Some(1));
        assert_eq!(section_number_from_text("1008:00"), Some(10));
        assert_eq!(section_number_from_text("08:00"), None);
    }

    #[test]
    fn removes_schedule_metadata_from_locations() {
        assert_eq!(
            location_from_text("地点：节，南湖-第1教学楼-七阶").as_deref(),
            Some("南湖-第1教学楼-七阶")
        );
        assert_eq!(
            location_from_text("第3节-第4节，南湖-第1教学楼-四阶·老师").as_deref(),
            Some("南湖-第1教学楼-四阶")
        );
        assert_eq!(
            location_from_text("周二第3节3-14周，南湖-第1教学楼-七阶").as_deref(),
            Some("南湖-第1教学楼-七阶")
        );
    }

    #[test]
    fn parses_dense_numeric_weekday_cards_and_plain_teacher_names() {
        let tokens = vec![
            token("星期一", 190.0, 40.0),
            token("星期二", 390.0, 40.0),
            token("星期三", 590.0, 40.0),
            token(
                "通信与网络|03\n李启豪\n3-8周,星期1,第1节--第2节\n南湖-第1教学楼-四阶",
                130.0,
                110.0,
            ),
            token(
                "通信与网络|03\n顾海军\n9-14周,星期1,第1节--第2节\n南湖-第1教学楼-四阶",
                130.0,
                210.0,
            ),
        ];
        let headers = weekday_headers(&tokens);
        let anchors = course_anchors(&tokens);
        let (courses, warnings) = anchor_courses(&tokens, &anchors, &headers, 800, 600);
        assert!(warnings.is_empty());
        assert_eq!(anchors.len(), 2);
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].name, "通信与网络[03]");
        assert_eq!(courses[0].teacher.as_deref(), Some("李启豪"));
        assert_eq!(courses[0].start_section, 1);
        assert_eq!(courses[0].end_section, 2);
        assert_eq!(courses[0].weeks, (3..=8).collect::<Vec<_>>());
        assert_eq!(courses[1].teacher.as_deref(), Some("顾海军"));
        assert_eq!(courses[1].weeks, (9..=14).collect::<Vec<_>>());
    }

    #[test]
    fn anchor_block_keeps_title_two_lines_above_schedule() {
        let tokens = vec![
            token("星期一", 190.0, 40.0),
            token("星期二", 390.0, 40.0),
            token("星期三", 590.0, 40.0),
            token("通信与网络|03", 130.0, 100.0),
            token("李启豪", 130.0, 130.0),
            token("3-8周,星期1,第1节--第2节", 130.0, 160.0),
            token("南湖-第1教学楼-四阶", 130.0, 190.0),
        ];
        let headers = weekday_headers(&tokens);
        let anchors = course_anchors(&tokens);
        let (courses, _) = anchor_courses(&tokens, &anchors, &headers, 800, 600);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "通信与网络[03]");
        assert_eq!(courses[0].teacher.as_deref(), Some("李启豪"));
    }

    #[test]
    fn fallback_splits_dense_cards_in_the_same_slot() {
        let tokens = vec![
            token("星期一", 190.0, 40.0),
            token("星期二", 390.0, 40.0),
            token("星期三", 590.0, 40.0),
            token("1", 20.0, 120.0),
            token("2", 20.0, 300.0),
            token("通信与网络|03", 130.0, 90.0),
            token("李启豪", 130.0, 118.0),
            token("3-8周,星期1,第1节--第2节", 130.0, 146.0),
            token("南湖-第1教学楼-四阶", 130.0, 174.0),
            token("通信与网络|03", 130.0, 204.0),
            token("顾海军", 130.0, 232.0),
            token("9-14周,星期1,第1节--第2节", 130.0, 260.0),
            token("南湖-第1教学楼-四阶", 130.0, 288.0),
        ];
        let headers = weekday_headers(&tokens);
        let sections = section_markers(&tokens, 800);
        let courses = fallback_courses(&tokens, &headers, &sections, 800, 600);
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].name, "通信与网络[03]");
        assert_eq!(courses[0].teacher.as_deref(), Some("李启豪"));
        assert_eq!(courses[0].weeks, (3..=8).collect::<Vec<_>>());
        assert_eq!(courses[1].name, "通信与网络[03]");
        assert_eq!(courses[1].teacher.as_deref(), Some("顾海军"));
        assert_eq!(courses[1].weeks, (9..=14).collect::<Vec<_>>());
    }

    #[test]
    fn recognizes_two_character_plain_teacher_names() {
        assert_eq!(
            bare_teacher_from_text("刘聪", "单片机原理及其应用[04]").as_deref(),
            Some("刘聪")
        );
        assert_eq!(
            bare_teacher_from_text("孙吉", "现场总线技术[03]").as_deref(),
            Some("孙吉")
        );
        assert_eq!(bare_teacher_from_text("信息论", "信息论").as_deref(), None);
    }

    #[test]
    fn extracts_course_from_native_tokens() {
        let tokens = vec![
            token("周一", 190.0, 40.0),
            token("周二", 390.0, 40.0),
            token("周三", 590.0, 40.0),
            token("周一第1节-第2节1-8周", 130.0, 110.0),
            token("通信原理", 130.0, 145.0),
            token("张老师", 130.0, 177.0),
            token("南湖-第一教学楼-四阶", 130.0, 209.0),
        ];
        let headers = weekday_headers(&tokens);
        let anchors = course_anchors(&tokens);
        let (courses, warnings) = anchor_courses(&tokens, &anchors, &headers, 800, 600);
        assert!(warnings.is_empty());
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "通信原理");
        assert_eq!(courses[0].teacher.as_deref(), Some("张老师"));
        assert_eq!(courses[0].location.as_deref(), Some("南湖-第一教学楼-四阶"));
        assert_eq!(courses[0].weeks, (1..=8).collect::<Vec<_>>());
    }

    #[test]
    fn extracts_course_when_card_is_one_ocr_token() {
        let tokens = vec![
            token("周一", 190.0, 40.0),
            token("周二", 390.0, 40.0),
            token("周三", 590.0, 40.0),
            token(
                "通信原理\n张老师\n南湖第一教学楼\n周一第1-2节1-8周",
                130.0,
                110.0,
            ),
        ];
        let headers = weekday_headers(&tokens);
        let anchors = course_anchors(&tokens);
        let (courses, _) = anchor_courses(&tokens, &anchors, &headers, 800, 600);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "通信原理");
        assert_eq!(courses[0].teacher.as_deref(), Some("张老师"));
        assert_eq!(courses[0].location.as_deref(), Some("南湖第一教学楼"));
    }

    #[test]
    fn fallback_accepts_section_labels_joined_with_times() {
        let tokens = vec![
            token("周一", 190.0, 40.0),
            token("周二", 390.0, 40.0),
            token("周三", 590.0, 40.0),
            token("108:00", 20.0, 110.0),
            token("208:55", 20.0, 170.0),
            token("通信原理", 150.0, 120.0),
            token("张老师", 150.0, 145.0),
        ];
        let headers = weekday_headers(&tokens);
        let sections = section_markers(&tokens, 800);
        let courses = fallback_courses(&tokens, &headers, &sections, 800, 600);
        assert_eq!(sections.len(), 2);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "通信原理");
    }
}
