#[cfg(test)]
mod weekday_header_tests {
    use super::*;

    fn sized_token(text: &str, left: f32, top: f32, width: f32, height: f32) -> Token {
        Token::from_text(text, 0.98, left, top, width, height).unwrap()
    }

    #[test]
    fn finds_header_row_below_phone_chrome_and_student_metadata() {
        let mut tokens = vec![
            sized_token("19:36", 20.0, 10.0, 80.0, 32.0),
            sized_token("正方教务管理系统", 100.0, 65.0, 300.0, 44.0),
            sized_token(
                "2025-2026学年第2学期学生个人课表",
                120.0,
                170.0,
                420.0,
                28.0,
            ),
            sized_token("学号姓名学院专业", 40.0, 220.0, 360.0, 24.0),
        ];
        for (index, text) in [
            "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日",
        ]
        .into_iter()
        .enumerate()
        {
            tokens.push(sized_token(
                text,
                120.0 + index as f32 * 110.0,
                320.0,
                76.0,
                24.0,
            ));
        }
        tokens.extend([
            sized_token("周一", 150.0, 650.0, 48.0, 22.0),
            sized_token("周二", 370.0, 650.0, 48.0, 22.0),
            sized_token("周三", 590.0, 650.0, 48.0, 22.0),
        ]);

        let headers = weekday_headers(&tokens);
        assert_eq!(headers.len(), 7);
        assert_eq!(
            headers
                .iter()
                .map(|header| header.weekday)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5, 6, 7]
        );
        assert!(headers.iter().all(|header| header.bottom < 360.0));
    }

    #[test]
    fn combines_split_weekday_header_boxes() {
        let tokens = vec![
            sized_token("页面标题", 20.0, 20.0, 180.0, 36.0),
            sized_token("星期", 120.0, 280.0, 52.0, 24.0),
            sized_token("一", 174.0, 280.0, 20.0, 24.0),
            sized_token("星期", 320.0, 280.0, 52.0, 24.0),
            sized_token("二", 374.0, 280.0, 20.0, 24.0),
            sized_token("星期", 520.0, 280.0, 52.0, 24.0),
            sized_token("三", 574.0, 280.0, 20.0, 24.0),
        ];

        let headers = weekday_headers(&tokens);
        assert_eq!(headers.len(), 3);
        assert_eq!(
            headers
                .iter()
                .map(|header| header.weekday)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }
}
