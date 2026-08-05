from pathlib import Path

GRID = Path("src-tauri/src/native_ocr/grid.rs")
NATIVE = Path("src-tauri/src/native_ocr.rs")
RUNTIME = Path("src-tauri/src/native_ocr/runtime.rs")
RELEASE = Path(".github/workflows/release-build.yml")
TESTS = Path("src-tauri/src/native_ocr/weekday_header_tests.rs")

NEW_FUNCTION = r'''fn weekday_headers(tokens: &[Token]) -> Vec<WeekdayHeader> {
    #[derive(Clone)]
    struct Candidate {
        header: WeekdayHeader,
        center_y: f32,
        height: f32,
    }

    let mut candidates = tokens
        .iter()
        .filter_map(|token| {
            weekday_from_text(&token.text).map(|weekday| Candidate {
                header: WeekdayHeader {
                    weekday,
                    center_x: token.center_x(),
                    bottom: token.bottom(),
                },
                center_y: token.center_y(),
                height: token.height.max(1.0),
            })
        })
        .collect::<Vec<_>>();

    // OCR may return `星期` and the final weekday character as separate boxes.
    for (prefix_index, prefix) in tokens.iter().enumerate() {
        let prefix_text = compact_text(&prefix.text);
        if prefix_text != "星期" && prefix_text != "周" {
            continue;
        }
        for (suffix_index, suffix) in tokens.iter().enumerate() {
            if prefix_index == suffix_index {
                continue;
            }
            let suffix_text = compact_text(&suffix.text);
            if suffix_text.chars().count() != 1 {
                continue;
            }
            let Some(weekday) = suffix_text.chars().next().and_then(weekday_character) else {
                continue;
            };
            let height = prefix.height.max(suffix.height).max(1.0);
            if (prefix.center_y() - suffix.center_y()).abs() > height * 0.8 + 4.0 {
                continue;
            }
            let horizontal_gap = suffix.left - prefix.right();
            if horizontal_gap < -height * 0.25 || horizontal_gap > height * 1.8 + 8.0 {
                continue;
            }
            let left = prefix.left.min(suffix.left);
            let right = prefix.right().max(suffix.right());
            let top = prefix.top.min(suffix.top);
            let bottom = prefix.bottom().max(suffix.bottom());
            candidates.push(Candidate {
                header: WeekdayHeader {
                    weekday,
                    center_x: (left + right) / 2.0,
                    bottom,
                },
                center_y: (top + bottom) / 2.0,
                height: (bottom - top).max(1.0),
            });
        }
    }

    let mut best_headers = Vec::new();
    let mut best_is_monotonic = false;
    let mut best_center_y = f32::MAX;
    let mut best_span = 0.0_f32;

    for seed in &candidates {
        let mut by_weekday: [Option<&Candidate>; 7] = std::array::from_fn(|_| None);
        for candidate in &candidates {
            let tolerance = seed.height.max(candidate.height) * 1.35 + 6.0;
            if (seed.center_y - candidate.center_y).abs() > tolerance {
                continue;
            }
            let slot = &mut by_weekday[(candidate.header.weekday - 1) as usize];
            let candidate_distance = (candidate.center_y - seed.center_y).abs();
            let should_replace = slot.is_none_or(|existing| {
                candidate_distance < (existing.center_y - seed.center_y).abs()
            });
            if should_replace {
                *slot = Some(candidate);
            }
        }

        let mut row = by_weekday
            .into_iter()
            .flatten()
            .map(|candidate| candidate.header.clone())
            .collect::<Vec<_>>();
        row.sort_by(|left, right| {
            left.center_x
                .partial_cmp(&right.center_x)
                .unwrap_or(Ordering::Equal)
        });
        let is_monotonic = row
            .windows(2)
            .all(|pair| pair[0].weekday < pair[1].weekday);
        let span = row
            .last()
            .zip(row.first())
            .map(|(last, first)| last.center_x - first.center_x)
            .unwrap_or_default();

        let is_better = row.len() > best_headers.len()
            || (row.len() == best_headers.len() && is_monotonic && !best_is_monotonic)
            || (row.len() == best_headers.len()
                && is_monotonic == best_is_monotonic
                && seed.center_y < best_center_y)
            || (row.len() == best_headers.len()
                && is_monotonic == best_is_monotonic
                && (seed.center_y - best_center_y).abs() < 1.0
                && span > best_span);
        if is_better {
            best_headers = row;
            best_is_monotonic = is_monotonic;
            best_center_y = seed.center_y;
            best_span = span;
        }
    }

    best_headers
}
'''

TEST_CONTENT = r'''#[cfg(test)]
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
'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one {label}, found {count}")
    return text.replace(old, new, 1)


grid = GRID.read_text(encoding="utf-8")
start = grid.index("fn weekday_headers(tokens: &[Token]) -> Vec<WeekdayHeader> {")
end = grid.index("\nfn section_markers", start)
GRID.write_text(grid[:start] + NEW_FUNCTION + grid[end:], encoding="utf-8", newline="\n")

native = NATIVE.read_text(encoding="utf-8")
native = replace_once(
    native,
    'include!("native_ocr/tests.rs");',
    'include!("native_ocr/tests.rs");\ninclude!("native_ocr/weekday_header_tests.rs");',
    "native OCR test include",
)
NATIVE.write_text(native, encoding="utf-8", newline="\n")

runtime = RUNTIME.read_text(encoding="utf-8")
runtime = replace_once(
    runtime,
    "ocr-rs-mnn-ppocrv5-mobile-v2",
    "ocr-rs-mnn-ppocrv5-mobile-v3",
    "recognizer version",
)
RUNTIME.write_text(runtime, encoding="utf-8", newline="\n")

release = RELEASE.read_text(encoding="utf-8")
release = replace_once(
    release,
    "COURSE_WIDGET_BUILD_VERSION: 0.5.0-beta.1",
    "COURSE_WIDGET_BUILD_VERSION: 0.5.0-beta.2",
    "candidate build version",
)
RELEASE.write_text(release, encoding="utf-8", newline="\n")

TESTS.write_text(TEST_CONTENT, encoding="utf-8", newline="\n")
