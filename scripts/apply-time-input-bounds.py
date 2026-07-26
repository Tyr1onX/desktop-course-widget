from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path} [{label}]: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f"{path} [{label}]: expected one match, found {count}")
    path.write_text(updated, encoding="utf-8")


main = Path("src/main.ts")
replace_once(
    main,
    '<input type="time" value="${options.time}" data-control="time">',
    '<input type="time" min="00:00" max="23:59" step="60" value="${options.time}" data-control="time">',
    "prototype time attributes",
)
regex_once(
    main,
    r"""    if \(control instanceof HTMLInputElement && control\.type === 'time'\) \{
      control\.addEventListener\('input', \(\) => \{
        const value = control\.value
        if \(!completeTimePattern\.test\(value\)\) return
        options\.time = value
        renderWidget\(\)
      \}\)
      return
    \}""",
    """    if (control instanceof HTMLInputElement && control.type === 'time') {
      let valueBeforeEdit = options.time
      control.addEventListener('focus', () => {
        valueBeforeEdit = options.time
      })
      control.addEventListener('input', () => {
        const value = control.value
        if (!completeTimePattern.test(value) || !control.validity.valid) return
        options.time = value
        renderWidget()
      })
      control.addEventListener('blur', () => {
        const value = control.value
        if (completeTimePattern.test(value) && control.validity.valid) return
        control.value = valueBeforeEdit
        options.time = valueBeforeEdit
        renderWidget()
      })
      return
    }""",
    "prototype time behavior",
)

settings = Path("src/settings.ts")
replace_once(
    settings,
    "const rowHeight = 66\n",
    "const rowHeight = 66\nconst completeTimePattern = /^(?:[01]\\d|2[0-3]):[0-5]\\d$/\n",
    "clock pattern",
)
regex_once(
    settings,
    r"""function timeToMinutes\(value: string\): number \{
  const \[hours, minutes\] = value\.split\(':'\)\.map\(Number\)
  return hours \* 60 \+ minutes
\}""",
    """function isValidClockTime(value: string): boolean {
  return completeTimePattern.test(value)
}

function timeToMinutes(value: string): number {
  if (!isValidClockTime(value)) return Number.NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}""",
    "clock parser",
)
replace_once(
    settings,
    '<input type="time" value="${item.start}" data-time-start="${item.section}" />',
    '<input type="time" min="00:00" max="23:59" step="60" value="${item.start}" data-time-start="${item.section}" />',
    "lesson start attributes",
)
replace_once(
    settings,
    '<input type="time" value="${item.end}" data-time-end="${item.section}" />',
    '<input type="time" min="00:00" max="23:59" step="60" value="${item.end}" data-time-end="${item.section}" />',
    "lesson end attributes",
)
regex_once(
    settings,
    r"""function bindTimeEvents\(\): void \{
  for \(const input of document\.querySelectorAll<HTMLInputElement>\('\[data-time-start\]'\)\) \{
    input\.addEventListener\('input', \(\) => \{
      const section = Number\(input\.dataset\.timeStart\)
      const item = timeDraft\.find\(\(value\) => value\.section === section\)
      if \(!item\) return
      item\.start = input\.value
      if \(timeEqualDuration\) applyEqualDuration\(\)
    \}\)
  \}
  for \(const input of document\.querySelectorAll<HTMLInputElement>\('\[data-time-end\]'\)\) \{
    input\.addEventListener\('input', \(\) => \{
      const section = Number\(input\.dataset\.timeEnd\)
      const item = timeDraft\.find\(\(value\) => value\.section === section\)
      if \(!item\) return
      item\.end = input\.value
      if \(timeEqualDuration && section === 1\) applyEqualDuration\(\)
    \}\)
  \}""",
    """function bindLessonTimeInput(input: HTMLInputElement, field: 'start' | 'end'): void {
  const section = Number(field === 'start' ? input.dataset.timeStart : input.dataset.timeEnd)
  const item = timeDraft.find((value) => value.section === section)
  if (!item) return
  let valueBeforeEdit = item[field]
  input.addEventListener('focus', () => {
    valueBeforeEdit = item[field]
  })
  input.addEventListener('input', () => {
    if (!isValidClockTime(input.value) || !input.validity.valid) return
    item[field] = input.value
    if (timeEqualDuration && (field === 'start' || section === 1)) applyEqualDuration()
  })
  input.addEventListener('blur', () => {
    if (isValidClockTime(input.value) && input.validity.valid) return
    input.value = valueBeforeEdit
    item[field] = valueBeforeEdit
    if (timeEqualDuration && (field === 'start' || section === 1)) applyEqualDuration()
  })
}

function bindTimeEvents(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-time-start]')) {
    bindLessonTimeInput(input, 'start')
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-time-end]')) {
    bindLessonTimeInput(input, 'end')
  }""",
    "lesson time behavior",
)
regex_once(
    settings,
    r"""    for \(const item of timeDraft\) \{
      if \(timeToMinutes\(item\.end\) <= timeToMinutes\(item\.start\)\) throw new Error\(`第 \$\{item\.section\} 节结束时间必须晚于开始时间`\)
    \}""",
    """    for (const item of timeDraft) {
      if (!isValidClockTime(item.start) || !isValidClockTime(item.end)) throw new Error(`第 ${item.section} 节时间必须在 00:00～23:59 之间`)
      if (timeToMinutes(item.end) <= timeToMinutes(item.start)) throw new Error(`第 ${item.section} 节结束时间必须晚于开始时间`)
    }""",
    "browser save validation",
)

rust = Path("src-tauri/src/app_settings.rs")
text = rust.read_text(encoding="utf-8")
if "fn rejects_out_of_range_clock_values()" not in text:
    position = text.rfind("\n}\n")
    if position < 0:
        raise SystemExit("app_settings.rs: test module closing brace not found")
    test = """

    #[test]
    fn rejects_out_of_range_clock_values() {
        let mut invalid_minutes = default_lesson_times();
        invalid_minutes[0].start = "08:60".into();
        assert!(normalize_lesson_times(invalid_minutes).is_err());

        let mut invalid_hours = default_lesson_times();
        invalid_hours[0].start = "24:00".into();
        assert!(normalize_lesson_times(invalid_hours).is_err());
    }
"""
    rust.write_text(text[:position] + test + text[position:], encoding="utf-8")
