#[cfg(test)]
mod generalization_regression_tests {
    use super::*;

    #[test]
    fn dynamic_week_warning_matches_actual_fallback_range() {
        let weeks = (1..=17).collect::<Vec<_>>();
        assert_eq!(
            fallback_week_warning("测试课程", &weeks),
            "测试课程 的周次未完整识别，已暂按 1～17 周填写"
        );
    }

    #[test]
    fn compact_ascii_room_codes_are_strong_location_evidence() {
        for value in ["A301", "F301"] {
            assert!(is_location_text(value));
            assert!(course_name_from_text(value).is_none());
        }
    }

    #[test]
    fn course_name_validity_does_not_depend_on_two_digit_codes() {
        for value in [
            "算法设计[3]",
            "算法设计[003]",
            "算法设计[A03]",
            "算法设计[CS101]",
        ] {
            assert_eq!(course_name_from_text(value).as_deref(), Some(value));
        }
    }
}
