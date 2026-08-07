from pathlib import Path

metadata = Path("src-tauri/src/native_ocr/metadata.rs")
text = metadata.read_text(encoding="utf-8")
old = r'''        r"^(?:(?:教|综|实|实验|实训|逸夫|文|理|工|体)[A-Za-z]?\d{0,2}[-－—–]\d{2,4}|(?:操场|体育场|体育馆)[A-Za-z0-9一二三四五六七八九十]*)(?:[（(](?:停|调)\d{3,8}[)）])?",'''
new = r'''        r"^(?:(?:教|综|实|实验|实训|逸夫|文|理|工|体)[A-Za-z]?\d{0,2}[-－—–]\d{2,4}|(?:操场|体育场|体育馆)(?:[-－—–]?[A-Za-z0-9一二三四五六七八九十]+))(?:[（(](?:停|调)\d{3,8}[)）])?",'''
if text.count(old) != 1:
    raise SystemExit(f"expected exactly one old sports prefix regex, found {text.count(old)}")
metadata.write_text(text.replace(old, new, 1), encoding="utf-8")

tests = Path("src-tauri/src/native_ocr/generalization_regression_tests.rs")
test_text = tests.read_text(encoding="utf-8")
regression = r'''

    #[test]
    fn sports_venue_prefix_requires_strong_location_suffix() {
        for name in ["体育馆建筑设计", "体育馆运营管理", "体育馆结构设计"] {
            assert_eq!(course_name_from_text(name).as_deref(), Some(name));
        }

        for (value, expected) in [
            ("体育馆A课程甲", "课程甲"),
            ("体育馆2课程乙", "课程乙"),
            ("体育馆-2课程丙", "课程丙"),
            ("体育馆101课程丁", "课程丁"),
        ] {
            assert_eq!(strip_traditional_grid_prefix(value), expected);
        }
    }
'''
if "sports_venue_prefix_requires_strong_location_suffix" in test_text:
    raise SystemExit("sports venue regression already exists")
marker = "\n}\n"
if not test_text.endswith(marker):
    raise SystemExit("unexpected regression test file ending")
tests.write_text(test_text[:-len(marker)] + regression + marker, encoding="utf-8")
