from __future__ import annotations

import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src-tauri/src/lib.rs",
    "mod import_draft;\nmod schedule_apply;",
    "mod import_draft;\nmod native_ocr;\nmod schedule_apply;",
)
replace_once(
    "src-tauri/src/lib.rs",
    """    let draft = tauri::async_runtime::spawn_blocking(move || {
        screenshot_import::recognize_screenshot(&path)
    })
""",
    """    let recognition_app = app.clone();
    let draft = tauri::async_runtime::spawn_blocking(move || {
        screenshot_import::recognize_screenshot(&recognition_app, &path)
    })
""",
)

config_path = Path("src-tauri/tauri.conf.json")
config = json.loads(config_path.read_text(encoding="utf-8"))
config["bundle"]["resources"] = ["resources/ocr-native/*"]
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

controller_path = Path("src/screenshot-import-controller.ts")
controller = controller_path.read_text(encoding="utf-8")
controller = controller.replace(
    "let recognitionPending = false\nlet createPending = false",
    "let recognitionPending = false\nlet recognitionStartedAt = 0\nlet recognitionTimer: number | null = null\nlet createPending = false",
    1,
)
start = controller.index("function updatePickerState(surface: HTMLElement): void {")
end = controller.index("\nasync function chooseScreenshot(): Promise<void> {", start)
replacement = r'''function updatePickerState(surface: HTMLElement): void {
  const excelPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-excel"]')
  const screenshotPicker = surface.querySelector<HTMLButtonElement>('[data-action="choose-screenshot"]')
  if (excelPicker) excelPicker.disabled = recognitionPending
  if (!screenshotPicker) return

  screenshotPicker.disabled = recognitionPending
  const elapsed = recognitionPending && recognitionStartedAt > 0
    ? Math.max(0, Math.floor((Date.now() - recognitionStartedAt) / 1000))
    : 0
  screenshotPicker.dataset.screenshotImportState = `${recognitionPending}:${desktopRuntime}:${elapsed}`
  screenshotPicker.innerHTML = `
    <strong>${recognitionPending ? `正在本机识别 · ${elapsed} 秒` : '选择 PNG / JPG 课表截图'}</strong>
    <span>${recognitionPending
      ? '正在使用课刻内置的 Rust OCR，识别完成前其他操作已锁定'
      : desktopRuntime
        ? '请使用完整单张截图，包含星期标题、节次和全部课程；暂不支持多图拼接'
        : '浏览器预览中不会读取本机图片'}</span>
  `
}

function setRecognitionBusy(surface: HTMLElement, busy: boolean): void {
  recognitionPending = busy
  document.documentElement.classList.toggle('screenshot-import-busy', busy)
  surface.toggleAttribute('aria-busy', busy)
  const controls = document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>(
    'button, input, select, textarea',
  )
  controls.forEach((control) => {
    if (busy) {
      if (!control.dataset.screenshotOcrWasDisabled) {
        control.dataset.screenshotOcrWasDisabled = control.disabled ? 'true' : 'false'
      }
      control.disabled = true
      return
    }
    const previous = control.dataset.screenshotOcrWasDisabled
    if (previous !== undefined) {
      control.disabled = previous === 'true'
      delete control.dataset.screenshotOcrWasDisabled
    }
  })

  if (busy) {
    recognitionStartedAt = Date.now()
    if (recognitionTimer !== null) window.clearInterval(recognitionTimer)
    recognitionTimer = window.setInterval(() => {
      const current = document.querySelector<HTMLElement>('.import-review-surface')
      if (current && recognitionPending) updatePickerState(current)
    }, 1000)
  } else {
    recognitionStartedAt = 0
    if (recognitionTimer !== null) window.clearInterval(recognitionTimer)
    recognitionTimer = null
  }
  updatePickerState(surface)
}
'''
controller = controller[:start] + replacement + controller[end:]
controller = controller.replace(
    """  recognitionPending = true
  setMessage(surface, '正在本机识别课表截图，首次准备 OCR 模型可能需要较长时间…')
  updatePickerState(surface)
""",
    """  setRecognitionBusy(surface, true)
  setMessage(surface, '正在使用课刻内置的本地识别引擎读取课表，通常只需几秒…')
""",
    1,
)
controller = controller.replace(
    """  } finally {
    recognitionPending = false
    const currentSurface = document.querySelector<HTMLElement>('.import-review-surface')
    if (currentSurface && !activeDraft) updatePickerState(currentSurface)
  }
""",
    """  } finally {
    const currentSurface = document.querySelector<HTMLElement>('.import-review-surface')
    if (currentSurface) setRecognitionBusy(currentSurface, false)
  }
""",
    1,
)
controller_path.write_text(controller, encoding="utf-8")

css_path = Path("src/settings.css")
css = css_path.read_text(encoding="utf-8")
css += r'''

/* Native screenshot OCR busy state */
.screenshot-import-busy,
.screenshot-import-busy body { cursor: wait; }
.screenshot-import-busy button:disabled,
.screenshot-import-busy input:disabled,
.screenshot-import-busy select:disabled,
.screenshot-import-busy textarea:disabled { pointer-events: none; }
.screenshot-import-busy .import-picker:disabled {
  border-style: solid;
  border-color: rgba(23, 105, 224, 0.32);
  background: rgba(23, 105, 224, 0.055);
  cursor: wait;
  opacity: 1;
}
.screenshot-import-busy .import-picker:disabled strong { color: #1f5fae; }
.screenshot-import-busy .import-picker:disabled span { color: #667382; }
'''
css_path.write_text(css, encoding="utf-8")
