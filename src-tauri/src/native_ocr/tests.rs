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
        assert_eq!(sections.len(), 12);
        assert_eq!(nearest_section(&sections, 170.0), 2);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "通信原理");
    }

    #[test]
    fn normalizes_missing_course_code_brackets_and_rejects_rosters() {
        assert_eq!(
            course_name_from_text("课程甲[03").as_deref(),
            Some("课程甲[03]")
        );
        assert_eq!(
            course_name_from_text("课程乙|04").as_deref(),
            Some("课程乙[04]")
        );
        assert!(course_name_from_text("24班级01,24班级02,24班级03").is_none());
    }

    #[test]
    fn fallback_teacher_is_read_after_title_when_anchor_is_title() {
        let tokens = vec![
            token("星期一", 190.0, 40.0),
            token("星期二", 390.0, 40.0),
            token("星期三", 590.0, 40.0),
            token("1", 20.0, 120.0),
            token("2", 20.0, 180.0),
            token("课程甲|03", 130.0, 90.0),
            token("李明", 130.0, 118.0),
            token("3-8周", 130.0, 146.0),
            token("第一教学楼", 130.0, 174.0),
        ];
        let headers = weekday_headers(&tokens);
        let sections = section_markers(&tokens, 800);
        let courses = fallback_courses(&tokens, &headers, &sections, 800, 600);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "课程甲[03]");
        assert_eq!(courses[0].teacher.as_deref(), Some("李明"));
    }

    #[test]
    fn sparse_section_markers_are_completed_before_position_mapping() {
        let tokens = vec![
            token("1", 20.0, 100.0),
            token("3", 20.0, 220.0),
            token("5", 20.0, 340.0),
        ];
        let sections = section_markers(&tokens, 800);
        assert_eq!(sections.len(), 12);
        assert_eq!(nearest_section(&sections, 160.0), 2);
        assert_eq!(nearest_section(&sections, 280.0), 4);
    }

    #[test]
    fn fallback_splits_consecutive_strong_course_titles() {
        let tokens = vec![
            token("星期一", 190.0, 40.0),
            token("星期二", 390.0, 40.0),
            token("星期三", 590.0, 40.0),
            token("1", 20.0, 100.0),
            token("2", 20.0, 160.0),
            token("3", 20.0, 220.0),
            token("课程甲|01", 130.0, 82.0),
            token("课程乙|02", 130.0, 142.0),
            token("李明", 130.0, 170.0),
            token("3-8周,星期1,第2节--第3节", 130.0, 198.0),
            token("第一教学楼", 130.0, 226.0),
        ];
        let headers = weekday_headers(&tokens);
        let sections = section_markers(&tokens, 800);
        let courses = fallback_courses(&tokens, &headers, &sections, 800, 600);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "课程乙[02]");
        assert_eq!(courses[0].teacher.as_deref(), Some("李明"));
        assert_eq!(courses[0].start_section, 2);
        assert_eq!(courses[0].end_section, 3);
    }


    #[test]
    fn parses_listed_sections_and_week_unions() {
        assert_eq!(section_range_from_text("周五第10,11,12节第6-8周"), Some((10, 12)));
        assert_eq!(section_range_from_text("周一第1，2节第1-17周"), Some((1, 2)));

        let (weeks, parity, used_default) =
            parse_weeks_and_parity("周四第8,9节第1周，第3-17周");
        assert!(!used_default);
        assert_eq!(parity, "all");
        assert_eq!(weeks, std::iter::once(1).chain(3..=17).collect::<Vec<_>>());

        let (weeks, parity, used_default) =
            parse_weeks_and_parity("周五第3,4节第2周，第6-16周双周");
        assert!(!used_default);
        assert_eq!(parity, "even");
        assert_eq!(weeks, vec![2, 6, 8, 10, 12, 14, 16]);
    }

    #[test]
    fn accepts_multiple_teacher_names_but_rejects_week_labels() {
        assert!(is_bare_teacher_name("张三/李四"));
        assert!(is_bare_teacher_name("张三、李四"));
        assert!(!is_bare_teacher_name("周单周"));
        assert!(!is_bare_teacher_name("现上课时间地点教师"));
    }

}
