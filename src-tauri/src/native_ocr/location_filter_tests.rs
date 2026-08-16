#[cfg(test)]
mod location_filter_tests {
    use super::*;

    #[test]
    fn compact_room_codes_are_not_course_names() {
        for value in ["教2-401", "教3-309", "教3-102", "操场A"] {
            assert!(is_location_text(value), "{value} should be classified as a location");
            assert!(
                course_name_from_text(value).is_none(),
                "{value} must never become a course title"
            );
        }
    }

    #[test]
    fn trailing_ui_glyphs_do_not_hide_strong_locations() {
        assert_eq!(
            location_after_trailing_decoration("节，北区-第1教学楼-三阶🍩").as_deref(),
            Some("北区-第1教学楼-三阶")
        );
        assert_eq!(
            location_after_trailing_decoration("北区-第1教学楼-四阶⊙").as_deref(),
            Some("北区-第1教学楼-四阶")
        );
    }

    #[test]
    fn decoration_noise_without_a_location_stays_empty() {
        assert_eq!(location_after_trailing_decoration("节，回"), None);
        assert_eq!(location_after_trailing_decoration("⊙"), None);
        assert_eq!(location_after_trailing_decoration("🍩"), None);
    }
}
