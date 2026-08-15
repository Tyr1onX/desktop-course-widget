#[cfg(test)]
mod field_association_regression_tests {
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
        anchor_courses(tokens, &anchors, &headers(), 1260, 700).0
    }

    #[test]
    fn case_a_keeps_coded_title_teacher_and_location_in_one_local_card() {
        let tokens = vec![
            token("嵌入式系统设计[04]", 120.0, 100.0, 150.0, 22.0),
            // A boundary-looking token in another weekday column must not split this title
            // from its teacher merely because their vertical ranges overlap.
            token("北区-第2教学楼-二阶", 390.0, 112.0, 150.0, 22.0),
            token("周明", 120.0, 126.0, 48.0, 22.0),
            // OCR boxes in wrapped cards may overlap vertically; a valid location remains
            // part of the current local card even when its center is slightly above the
            // schedule anchor center.
            token("北区-第1教学楼-三阶", 120.0, 148.0, 150.0, 22.0),
            token("周一第5-6节6-13周", 120.0, 154.0, 160.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "嵌入式系统设计[04]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("周明"));
        assert_eq!(parsed[0].location.as_deref(), Some("北区-第1教学楼-三阶"));
        assert_eq!((parsed[0].weekday, parsed[0].start_section, parsed[0].end_section), (1, 5, 6));
        assert_eq!(parsed[0].weeks, (6..=13).collect::<Vec<_>>());
    }

    #[test]
    fn case_b_bare_teacher_does_not_replace_an_available_coded_title() {
        let tokens = vec![
            token("概率论[04]", 660.0, 100.0, 100.0, 22.0),
            token("陈航", 660.0, 126.0, 48.0, 22.0),
            token("周四第5-6节3-10周", 660.0, 154.0, 160.0, 22.0),
            token("北区-第1教学楼-四阶", 660.0, 180.0, 150.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "概率论[04]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("陈航"));
        assert_eq!(parsed[0].location.as_deref(), Some("北区-第1教学楼-四阶"));
    }

    #[test]
    fn case_c_same_slot_different_weeks_keep_their_own_teacher_and_location() {
        let tokens = vec![
            token("网络系统[03]", 480.0, 100.0, 110.0, 22.0),
            token("林宇", 480.0, 126.0, 48.0, 22.0),
            token("周三第3-4节3-8周", 480.0, 154.0, 160.0, 22.0),
            token("北区-第1教学楼-三阶", 480.0, 180.0, 150.0, 22.0),
            token("网络系统[03]", 480.0, 228.0, 110.0, 22.0),
            token("赵宁", 480.0, 254.0, 48.0, 22.0),
            token("周三第3-4节9-14周", 480.0, 282.0, 160.0, 22.0),
            token("北区-第1教学楼-四阶", 480.0, 308.0, 150.0, 22.0),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "网络系统[03]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("林宇"));
        assert_eq!(parsed[0].location.as_deref(), Some("北区-第1教学楼-三阶"));
        assert_eq!(parsed[0].weeks, (3..=8).collect::<Vec<_>>());
        assert_eq!(parsed[1].name, "网络系统[03]");
        assert_eq!(parsed[1].teacher.as_deref(), Some("赵宁"));
        assert_eq!(parsed[1].location.as_deref(), Some("北区-第1教学楼-四阶"));
        assert_eq!(parsed[1].weeks, (9..=14).collect::<Vec<_>>());
    }

    #[test]
    fn case_d_field_words_remain_valid_course_titles() {
        for title in [
            "教师职业道德",
            "教师教育学",
            "体育馆建筑设计",
            "室内设计",
            "数据中心技术",
        ] {
            assert_eq!(course_name_from_text(title).as_deref(), Some(title));
        }
    }

    #[test]
    fn case_e_location_embedded_in_schedule_token_stays_with_that_card() {
        let tokens = vec![
            token("嵌入式接口技术[04]", 480.0, 100.0, 150.0, 22.0),
            token("周明", 480.0, 126.0, 48.0, 22.0),
            // The old baseline split ordinary whitespace into parts. The structural parser
            // now keeps the OCR line intact, so schedule and location can arrive as one token.
            token(
                "6-13周, 星期3, 第1节-第2节, 北区-第1教学楼-三阶",
                480.0,
                154.0,
                260.0,
                22.0,
            ),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "嵌入式接口技术[04]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("周明"));
        assert_eq!(parsed[0].location.as_deref(), Some("北区-第1教学楼-三阶"));
        assert_eq!((parsed[0].weekday, parsed[0].start_section, parsed[0].end_section), (3, 1, 2));
        assert_eq!(parsed[0].weeks, (6..=13).collect::<Vec<_>>());
    }

    #[test]
    fn case_f_location_attached_directly_to_section_tail_is_recovered() {
        let tokens = vec![
            token("嵌入式接口技术[04]", 480.0, 100.0, 150.0, 22.0),
            token("周明", 480.0, 126.0, 48.0, 22.0),
            token(
                "6-13周,星期3,第1节-第2节北区-第1教学楼-三阶",
                480.0,
                154.0,
                280.0,
                22.0,
            ),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "嵌入式接口技术[04]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("周明"));
        assert_eq!(parsed[0].location.as_deref(), Some("北区-第1教学楼-三阶"));
        assert_eq!((parsed[0].weekday, parsed[0].start_section, parsed[0].end_section), (3, 1, 2));
        assert_eq!(parsed[0].weeks, (6..=13).collect::<Vec<_>>());
    }

    #[test]
    fn case_g_explicit_no_location_tail_does_not_invent_a_location() {
        let tokens = vec![
            token("网络系统[03]", 480.0, 100.0, 120.0, 22.0),
            token("赵宁", 480.0, 126.0, 48.0, 22.0),
            token(
                "9-14周,星期3,第3节-第4节无",
                480.0,
                154.0,
                220.0,
                22.0,
            ),
        ];
        let parsed = courses(&tokens);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "网络系统[03]");
        assert_eq!(parsed[0].teacher.as_deref(), Some("赵宁"));
        assert_eq!(parsed[0].location, None);
        assert_eq!((parsed[0].weekday, parsed[0].start_section, parsed[0].end_section), (3, 3, 4));
        assert_eq!(parsed[0].weeks, (9..=14).collect::<Vec<_>>());
    }
}
