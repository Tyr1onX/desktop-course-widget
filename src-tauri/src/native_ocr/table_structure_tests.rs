#[cfg(test)]
mod table_structure_tests {
    use super::*;

    fn sized_token(text: &str, left: f32, top: f32, width: f32, height: f32) -> Token {
        Token::from_text(text, 0.98, left, top, width, height).unwrap()
    }

    fn basic_headers() -> Vec<WeekdayHeader> {
        vec![
            WeekdayHeader { weekday: 1, center_x: 190.0, bottom: 80.0 },
            WeekdayHeader { weekday: 2, center_x: 390.0, bottom: 80.0 },
            WeekdayHeader { weekday: 3, center_x: 590.0, bottom: 80.0 },
        ]
    }

    #[test]
    fn table_bottom_stops_before_following_metadata_tables() {
        let sections = (1..=12)
            .map(|section| (section, 120.0 + (section as f32 - 1.0) * 50.0))
            .collect::<Vec<_>>();
        let bottom = timetable_content_bottom(&[], &sections, 1000);
        assert!(bottom > 690.0 && bottom < 710.0);

        let tokens = vec![
            sized_token("计算机问题求解：使", 120.0, 170.0, 150.0, 22.0),
            sized_token("用算法（混合式）", 120.0, 196.0, 150.0, 22.0),
            sized_token("周一第3-4节第1-17周", 120.0, 224.0, 170.0, 22.0),
            sized_token("毛毅", 120.0, 252.0, 50.0, 22.0),
            sized_token("教3-201", 120.0, 278.0, 70.0, 22.0),
            sized_token("上课时间", 120.0, 760.0, 90.0, 22.0),
            sized_token("周一第10-12节第5周", 120.0, 786.0, 180.0, 22.0),
            sized_token("学分", 120.0, 820.0, 50.0, 22.0),
            sized_token("起止周", 120.0, 846.0, 70.0, 22.0),
        ];
        let table_tokens = tokens
            .into_iter()
            .filter(|token| token.center_y() <= bottom)
            .collect::<Vec<_>>();
        let anchors = course_anchors(&table_tokens);
        let (courses, _) = anchor_courses(&table_tokens, &anchors, &basic_headers(), 800, 1000);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "计算机问题求解：使用算法（混合式）");
        assert_eq!(courses[0].teacher.as_deref(), Some("毛毅"));
        assert_eq!(courses[0].location.as_deref(), Some("教3-201"));
        assert!(courses.iter().all(|course| !matches!(course.name.as_str(), "上课时间" | "学分" | "起止周")));
    }

    #[test]
    fn reconstructs_multiline_title_before_schedule_anchor() {
        let tokens = vec![
            sized_token("人工智能导论及其", 520.0, 120.0, 160.0, 22.0),
            sized_token("Python应用实践", 520.0, 146.0, 160.0, 22.0),
            sized_token("周三第1-2节第1-17周", 520.0, 174.0, 180.0, 22.0),
            sized_token("左益平", 520.0, 202.0, 60.0, 22.0),
            sized_token("教3-511", 520.0, 228.0, 70.0, 22.0),
        ];
        let anchors = course_anchors(&tokens);
        let (courses, _) = anchor_courses(&tokens, &anchors, &basic_headers(), 800, 500);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "人工智能导论及其Python应用实践");
        assert_eq!(courses[0].teacher.as_deref(), Some("左益平"));
        assert_eq!(courses[0].location.as_deref(), Some("教3-511"));
    }

    #[test]
    fn title_before_anchor_wins_over_teacher_and_sports_location() {
        let tokens = vec![
            sized_token("男生网球", 520.0, 150.0, 90.0, 22.0),
            sized_token("周三第6-7节第1-17周", 520.0, 178.0, 180.0, 22.0),
            sized_token("凌勇", 520.0, 206.0, 50.0, 22.0),
            sized_token("操场A", 520.0, 232.0, 70.0, 22.0),
        ];
        let anchors = course_anchors(&tokens);
        let (courses, _) = anchor_courses(&tokens, &anchors, &basic_headers(), 800, 500);
        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].name, "男生网球");
        assert_eq!(courses[0].teacher.as_deref(), Some("凌勇"));
        assert_eq!(courses[0].location.as_deref(), Some("操场A"));
    }

    #[test]
    fn weekday_edges_do_not_include_the_left_time_column() {
        let headers = basic_headers();
        assert_eq!(weekday_column_bounds(&headers, 1, 800.0), (90.0, 290.0));
        assert_eq!(weekday_column_bounds(&headers, 3, 800.0), (490.0, 690.0));
    }

    #[test]
    fn arbitrary_two_line_fields_are_not_course_cards() {
        let group = vec![
            sized_token("学分", 120.0, 120.0, 50.0, 22.0),
            sized_token("起止周", 120.0, 148.0, 70.0, 22.0),
        ];
        assert!(!group_has_card_body(&group));
    }

    #[test]
    fn compact_room_shorthand_is_a_location() {
        assert_eq!(compact_location_from_text("教3-201").as_deref(), Some("教3-201"));
        assert_eq!(compact_location_from_text("操场A").as_deref(), Some("操场A"));
        assert!(compact_location_from_text("毛毅").is_none());
    }

    #[test]
    fn strict_section_markers_ignore_schedule_text_in_monday_column() {
        let mut tokens = vec![
            sized_token("星期一", 190.0, 40.0, 80.0, 24.0),
            sized_token("星期二", 390.0, 40.0, 80.0, 24.0),
            sized_token("星期三", 590.0, 40.0, 80.0, 24.0),
            sized_token("周一第1,2节第1-17周", 130.0, 155.0, 170.0, 22.0),
        ];
        for section in 1..=12 {
            tokens.push(sized_token(
                &format!("第{section}节"),
                25.0,
                100.0 + (section as f32 - 1.0) * 50.0,
                45.0,
                22.0,
            ));
        }
        let sections = section_markers(&tokens, 800);
        assert_eq!(sections.len(), 12);
        assert!((sections[0].1 - 111.0).abs() < 1.0);
        assert!((sections[1].1 - 161.0).abs() < 1.0);
    }

    #[test]
    fn one_multiline_ocr_box_yields_two_courses_without_footer_rows() {
        let mut raw_tokens = vec![
            sized_token("星期一", 190.0, 40.0, 80.0, 24.0),
            sized_token("星期二", 390.0, 40.0, 80.0, 24.0),
            sized_token("星期三", 590.0, 40.0, 80.0, 24.0),
            sized_token(
                "课程甲（混合式）\n周一第1,2节第1-17周\n张三\n教3-201\n课程乙实验\n周一第1,2节第2周，第6-16周双周\n李四/王五\n教3-202",
                120.0,
                105.0,
                150.0,
                280.0,
            ),
            sized_token("实践课信息", 120.0, 730.0, 100.0, 22.0),
            sized_token("先修模块", 120.0, 758.0, 90.0, 22.0),
            sized_token("周一第10,11,12节第5周", 120.0, 786.0, 190.0, 22.0),
        ];
        for section in 1..=12 {
            raw_tokens.push(sized_token(
                &format!("第{section}节"),
                25.0,
                100.0 + (section as f32 - 1.0) * 50.0,
                45.0,
                22.0,
            ));
        }

        let tokens = expand_multiline_tokens(raw_tokens);
        let headers = weekday_headers(&tokens);
        let sections = section_markers(&tokens, 800);
        let bottom = timetable_content_bottom(&tokens, &sections, 1000);
        let table_tokens = tokens
            .into_iter()
            .filter(|token| token.center_y() <= bottom)
            .collect::<Vec<_>>();
        let anchors = course_anchors(&table_tokens);
        let (courses, _) = anchor_courses(&table_tokens, &anchors, &headers, 800, 1000);

        assert_eq!(anchors.len(), 2);
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].name, "课程甲（混合式）");
        assert_eq!(courses[0].start_section, 1);
        assert_eq!(courses[0].end_section, 2);
        assert_eq!(courses[0].teacher.as_deref(), Some("张三"));
        assert_eq!(courses[0].location.as_deref(), Some("教3-201"));
        assert_eq!(courses[1].name, "课程乙实验");
        assert_eq!(courses[1].weeks, vec![2, 6, 8, 10, 12, 14, 16]);
        assert_eq!(courses[1].teacher.as_deref(), Some("李四/王五"));
        assert_eq!(courses[1].location.as_deref(), Some("教3-202"));
        assert!(courses.iter().all(|course| course.name != "先修模块"));
    }


    #[test]
    fn ordinary_spaces_do_not_turn_one_ocr_line_into_vertical_rows() {
        let tokens = expand_multiline_tokens(vec![sized_token(
            "周一 第1,2节 （第1-17周）",
            120.0,
            120.0,
            180.0,
            24.0,
        )]);
        assert_eq!(tokens.len(), 1);
        let anchors = course_anchors(&tokens);
        assert_eq!(anchors.len(), 1);
        assert_eq!((anchors[0].start_section, anchors[0].end_section), (1, 2));
        assert_eq!(anchors[0].weeks, (1..=17).collect::<Vec<_>>());
    }

    #[test]
    fn wrapped_schedule_lines_restore_parity_and_explicit_week_ranges() {
        let tokens = vec![
            sized_token("课程甲实验", 120.0, 110.0, 130.0, 22.0),
            sized_token("周一第6,7节(第2-16", 120.0, 138.0, 170.0, 22.0),
            sized_token("周双周)", 120.0, 164.0, 70.0, 22.0),
            sized_token("张三", 120.0, 190.0, 50.0, 22.0),
            sized_token("教3-201", 120.0, 216.0, 70.0, 22.0),
            sized_token("课程乙专题", 520.0, 110.0, 130.0, 22.0),
            sized_token("周三第10,11,12节(第", 520.0, 138.0, 190.0, 22.0),
            sized_token("6-8周)", 520.0, 164.0, 70.0, 22.0),
            sized_token("李四", 520.0, 190.0, 50.0, 22.0),
            sized_token("教3-202", 520.0, 216.0, 70.0, 22.0),
        ];
        let anchors = course_anchors(&tokens);
        assert_eq!(anchors.len(), 2);
        assert_eq!((anchors[0].start_section, anchors[0].end_section), (6, 7));
        assert_eq!(anchors[0].weeks, vec![2, 4, 6, 8, 10, 12, 14, 16]);
        assert_eq!(anchors[0].parity, "even");
        assert_eq!((anchors[1].start_section, anchors[1].end_section), (10, 12));
        assert_eq!(anchors[1].weeks, vec![6, 7, 8]);
    }

    #[test]
    fn punctuated_footer_headers_cut_off_practice_tables() {
        assert!(is_footer_table_header("调、停（补）课信息："));
        assert!(is_footer_table_header("实践课(或无上课时间)信息:"));
        let sections = (1..=12)
            .map(|section| (section, 120.0 + (section as f32 - 1.0) * 50.0))
            .collect::<Vec<_>>();
        let tokens = vec![sized_token(
            "实践课(或无上课时间)信息:",
            120.0,
            682.0,
            210.0,
            22.0,
        )];
        let bottom = timetable_content_bottom(&tokens, &sections, 1000);
        assert!(bottom < 682.0);
    }

    #[test]
    fn traditional_room_and_change_metadata_are_not_part_of_titles() {
        assert_eq!(
            course_name_from_text("教3-201（停0079）操作系统实验（混合式）").as_deref(),
            Some("操作系统实验（混合式）")
        );
        assert_eq!(
            course_name_from_text("教3-312人工智能应用实践").as_deref(),
            Some("人工智能应用实践")
        );
    }


    #[test]
    fn complete_schedule_does_not_absorb_next_course_week_range() {
        let tokens = vec![
            sized_token("概率论与数理统计", 520.0, 110.0, 150.0, 22.0),
            sized_token("周五第3,4节第1-17周", 520.0, 138.0, 180.0, 22.0),
            sized_token("王雪红", 520.0, 164.0, 60.0, 22.0),
            sized_token("教3-512", 520.0, 190.0, 70.0, 22.0),
            sized_token("操作系统基础（混合式）", 520.0, 220.0, 180.0, 22.0),
            sized_token("周五第3,4节", 520.0, 248.0, 120.0, 22.0),
            sized_token("第6-16周双周", 520.0, 274.0, 110.0, 22.0),
        ];

        let text = schedule_text_for_anchor(&tokens, 1);
        let (weeks, parity, used_default) = parse_weeks_and_parity(&text);
        assert_eq!(weeks, (1..=17).collect::<Vec<_>>());
        assert_eq!(parity, "all");
        assert!(!used_default);
    }

    #[test]
    fn incomplete_schedule_stops_at_teacher_before_unrelated_week_range() {
        let tokens = vec![
            sized_token("周五第3,4节", 520.0, 138.0, 120.0, 22.0),
            sized_token("王雪红", 520.0, 164.0, 60.0, 22.0),
            sized_token("教3-512", 520.0, 190.0, 70.0, 22.0),
            sized_token("第6-16周双周", 520.0, 216.0, 110.0, 22.0),
        ];

        let text = schedule_text_for_anchor(&tokens, 0);
        assert_eq!(text, "周五第3,4节");
    }

    #[test]
    fn missing_week_range_adopts_detected_semester_maximum() {
        let tokens = vec![
            sized_token("周一第1,2节", 120.0, 138.0, 120.0, 22.0),
            sized_token("周二第1,2节第1-17周", 320.0, 138.0, 180.0, 22.0),
        ];
        let anchors = course_anchors(&tokens);
        assert_eq!(anchors.len(), 2);
        assert_eq!(anchors[0].weeks, (1..=17).collect::<Vec<_>>());
        assert!(anchors[0].used_default_weeks);
        assert_eq!(anchors[1].weeks, (1..=17).collect::<Vec<_>>());
    }

    #[test]
    fn reliable_grid_anchors_disable_unstructured_fallback() {
        assert!(!should_use_fallback(false, 3));
        assert!(should_use_fallback(false, 2));
        assert!(!should_use_fallback(true, 8));
    }

}
