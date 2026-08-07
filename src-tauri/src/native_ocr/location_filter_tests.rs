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
}
