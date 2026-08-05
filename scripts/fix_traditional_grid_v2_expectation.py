from pathlib import Path

path = Path("scripts/apply_traditional_grid_v2.py")
text = path.read_text(encoding="utf-8")
old = '        assert_eq!(weeks, (1..=17).collect::<Vec<_>>());'
new = '        assert_eq!(weeks, std::iter::once(1).chain(3..=17).collect::<Vec<_>>());'
if text.count(old) != 1:
    raise RuntimeError(f"expected one stale week union assertion, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
