from __future__ import annotations

from pathlib import Path

path = Path(__file__).with_name("apply-ocr-performance-followup.py")
text = path.read_text(encoding="utf-8")
start_marker = "# Every result carries worker metrics; early failures use an empty duration list.\n"
end_marker = "old_loop = '''"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("follow-up generator metric block was not found")
replacement = '''# Every headless OCR result carries worker metrics; unrelated schedule result types
# must remain untouched.
headless_start = lib.find("fn schedule_headless_ocr_smoke(")
headless_end = lib.find("\\nfn write_headless_result", headless_start)
if headless_start < 0 or headless_end < 0:
    raise SystemExit("lib.rs: headless OCR function boundaries changed")
headless_block = lib[headless_start:headless_end]
headless_block = re.sub(
    r"(?m)^(\\s+)course_count: ([^\\n]+),\\n",
    lambda match: (
        f"{match.group(1)}course_count: {match.group(2)},\\n"
        f"{match.group(1)}worker_start_count: screenshot_import::worker_start_count(),\\n"
        f"{match.group(1)}run_durations_ms: Vec::new(),\\n"
    ),
    headless_block,
)
lib = lib[:headless_start] + headless_block + lib[headless_end:]
'''
path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
print("Narrowed OCR metric patch to the headless smoke function")
