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
        let bottom = timetable_content_bottom(&sections, 1000);
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
            sized_token("人工智能导论及其", 120.0, 120.0, 160.0, 22.0),
            sized_token("Python应用实践", 120.0, 146.0, 160.0, 22.0),
            sized_token("周三第1-2节第1-17周", 120.0, 174.0, 180.0, 22.0),
            sized_token("左益平", 120.0, 202.0, 60.0, 22.0),
            sized_token("教3-511", 120.0, 228.0, 70.0, 22.0),
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
}
