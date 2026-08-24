#[cfg(test)]
mod main_grid_roi_tests {
    use super::*;
    use std::path::Path;

    fn token(text: &str, left: f32, top: f32, width: f32, height: f32) -> Token {
        Token::from_text(text, 0.98, left, top, width, height).unwrap()
    }

    fn headers() -> Vec<WeekdayHeader> {
        vec![
            WeekdayHeader {
                weekday: 1,
                center_x: 190.0,
                bottom: 64.0,
            },
            WeekdayHeader {
                weekday: 2,
                center_x: 390.0,
                bottom: 64.0,
            },
            WeekdayHeader {
                weekday: 3,
                center_x: 590.0,
                bottom: 64.0,
            },
        ]
    }

    #[test]
    fn main_grid_bounds_follow_weekday_columns_and_header_bottom() {
        let (left, right, top) = main_timetable_grid_bounds(&headers(), 800).unwrap();
        assert!((left - 90.0).abs() < 0.1);
        assert!((right - 690.0).abs() < 0.1);
        assert!((top - 64.0).abs() < 0.1);
    }

    #[test]
    fn schedule_shaped_text_outside_main_grid_never_becomes_a_course() {
        let mut tokens = vec![
            token("星期一", 150.0, 40.0, 80.0, 24.0),
            token("星期二", 350.0, 40.0, 80.0, 24.0),
            token("星期三", 550.0, 40.0, 80.0, 24.0),
            token("主表课程", 120.0, 110.0, 110.0, 22.0),
            token("周一第1-2节第1-17周", 120.0, 138.0, 170.0, 22.0),
            token("张三", 120.0, 166.0, 50.0, 22.0),
            token("教3-201", 120.0, 194.0, 70.0, 22.0),
            // This looks exactly like a course card but is outside the weekday grid.
            // The screenshot importer deliberately ignores such surrounding content.
            token("表外课程", 705.0, 240.0, 80.0, 22.0),
            token("周三第5-6节第1-17周", 700.0, 268.0, 95.0, 22.0),
            token("李四", 720.0, 296.0, 45.0, 22.0),
        ];
        for section in 1..=12 {
            tokens.push(token(
                &format!("第{section}节"),
                25.0,
                100.0 + (section as f32 - 1.0) * 50.0,
                45.0,
                22.0,
            ));
        }

        let draft = tokens_to_draft(Path::new("grid-only.png"), 800, 800, 800, 800, &tokens)
            .expect("main timetable course should parse");

        assert_eq!(draft.courses.len(), 1);
        assert_eq!(draft.courses[0].name, "主表课程");
        assert!(draft.courses.iter().all(|course| course.name != "表外课程"));
    }
}
