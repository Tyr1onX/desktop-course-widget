from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def append_once(path: str, marker: str, content: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if marker in text:
        raise RuntimeError(f"marker already present in {path}: {marker}")
    file.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8", newline="\n")


replace_once(
    "scripts/test-ocr-enabled-installer.ps1",
    """function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw \"Command failed with exit code $LASTEXITCODE`: $FilePath $($ArgumentList -join ' ')\"
  }
}
""",
    """function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  foreach ($argument in $ArgumentList) {
    [void]$startInfo.ArgumentList.Add($argument)
  }
  $process = [Diagnostics.Process]::Start($startInfo)
  if (-not $process) {
    throw \"Could not start command: $FilePath\"
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw \"Command failed with exit code $($process.ExitCode)`: $FilePath $($ArgumentList -join ' ')\"
  }
}
""",
)

replace_once(
    "src-tauri/src/screenshot_import.rs",
    """use std::{
    env, fs,
    fs::File,
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
""",
    """use std::{
    env, fs,
    fs::File,
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
""",
)

replace_once(
    "src-tauri/src/screenshot_import.rs",
    "const OCR_TIMEOUT: Duration = Duration::from_secs(10 * 60);\n",
    """const OCR_TIMEOUT: Duration = Duration::from_secs(10 * 60);
static RECOGNITION_RUNNING: AtomicBool = AtomicBool::new(false);
static CANCELLATION_REQUESTED: AtomicBool = AtomicBool::new(false);

pub(crate) struct RecognitionGuard;

pub(crate) fn begin_recognition() -> Result<RecognitionGuard, String> {
    if RECOGNITION_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("已有课表截图正在识别，请稍候或先取消当前识别".into());
    }
    CANCELLATION_REQUESTED.store(false, Ordering::SeqCst);
    Ok(RecognitionGuard)
}

pub(crate) fn cancel_recognition() -> bool {
    if !RECOGNITION_RUNNING.load(Ordering::SeqCst) {
        return false;
    }
    CANCELLATION_REQUESTED.store(true, Ordering::SeqCst);
    true
}

fn cancellation_requested() -> bool {
    CANCELLATION_REQUESTED.load(Ordering::SeqCst)
}

impl Drop for RecognitionGuard {
    fn drop(&mut self) {
        CANCELLATION_REQUESTED.store(false, Ordering::SeqCst);
        RECOGNITION_RUNNING.store(false, Ordering::SeqCst);
    }
}
""",
)

replace_once(
    "src-tauri/src/screenshot_import.rs",
    """    loop {
        if let Some(status) = process
            .try_wait()
""",
    """    loop {
        if cancellation_requested() {
            let _ = process.kill();
            let _ = process.wait();
            return Err("已取消截图识别".into());
        }
        if let Some(status) = process
            .try_wait()
""",
)

replace_once(
    "src-tauri/src/screenshot_import.rs",
    """    #[test]
    fn rejects_unsupported_image_extensions() {
""",
    """    #[test]
    fn recognition_guard_blocks_parallel_runs_and_supports_cancel() {
        let guard = begin_recognition().unwrap();
        assert!(begin_recognition().is_err());
        assert!(cancel_recognition());
        assert!(cancellation_requested());
        drop(guard);
        assert!(!cancel_recognition());
        assert!(!cancellation_requested());
        drop(begin_recognition().unwrap());
    }

    #[test]
    fn rejects_unsupported_image_extensions() {
""",
)

replace_once(
    "src-tauri/src/lib.rs",
    """#[tauri::command]
async fn choose_and_parse_screenshot(
""",
    """#[tauri::command]
fn cancel_screenshot_recognition() -> bool {
    screenshot_import::cancel_recognition()
}

#[tauri::command]
async fn choose_and_parse_screenshot(
""",
)

replace_once(
    "src-tauri/src/lib.rs",
    """    let path = selected
        .into_path()
        .map_err(|_| "无法读取所选课表截图路径".to_owned())?;
    let recognition_app = app.clone();
""",
    """    let path = selected
        .into_path()
        .map_err(|_| "无法读取所选课表截图路径".to_owned())?;
    let _recognition_guard = screenshot_import::begin_recognition()?;
    let recognition_app = app.clone();
""",
)

replace_once(
    "src-tauri/src/lib.rs",
    """            prepare_screenshot_ocr_component,
            choose_and_parse_screenshot,
""",
    """            prepare_screenshot_ocr_component,
            cancel_screenshot_recognition,
            choose_and_parse_screenshot,
""",
)

replace_once(
    "src/screenshot-import-controller.ts",
    """let recognitionPending = false
let componentPending = false
""",
    """let recognitionPending = false
let recognitionCancelPending = false
let recognitionStageTimers: number[] = []
let componentPending = false
""",
)

progress_helpers = """
function showRecognitionProgress(surface: HTMLElement): void {
  let panel = surface.querySelector<HTMLElement>('[data-screenshot-import-progress]')
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'screenshot-import-progress'
    panel.dataset.screenshotImportProgress = 'true'
    panel.setAttribute('aria-live', 'polite')
    panel.innerHTML = `
      <div class="screenshot-import-progress__heading">
        <strong data-screenshot-import-progress-title>正在加载本地识别模型…</strong>
        <button class="screenshot-import-progress__cancel" type="button" data-screenshot-import-cancel>取消识别</button>
      </div>
      <div class="screenshot-import-progress__track" aria-hidden="true"><span></span></div>
      <p data-screenshot-import-progress-detail>图片只在本机处理，不会上传。</p>
    `
    const message = surface.querySelector('.surface-message')
    if (message) message.before(panel)
    else surface.append(panel)
    panel.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
      ?.addEventListener('click', () => void cancelScreenshotRecognition())
  }
  updateRecognitionProgress('正在加载本地识别模型…', '图片只在本机处理，不会上传。')
  recognitionStageTimers.forEach((timer) => window.clearTimeout(timer))
  recognitionStageTimers = [
    window.setTimeout(() => {
      if (recognitionPending && !recognitionCancelPending) {
        updateRecognitionProgress('正在读取课表文字…', '正在分析星期、节次和课程内容。')
      }
    }, 1_800),
    window.setTimeout(() => {
      if (recognitionPending && !recognitionCancelPending) {
        updateRecognitionProgress('仍在本机识别…', '较大的图片可能需要更长时间，请保持课刻开启。')
      }
    }, 15_000),
  ]
}

function updateRecognitionProgress(title: string, detail: string): void {
  const panel = document.querySelector<HTMLElement>('[data-screenshot-import-progress]')
  const titleTarget = panel?.querySelector<HTMLElement>('[data-screenshot-import-progress-title]')
  const detailTarget = panel?.querySelector<HTMLElement>('[data-screenshot-import-progress-detail]')
  if (titleTarget) titleTarget.textContent = title
  if (detailTarget) detailTarget.textContent = detail
}

function hideRecognitionProgress(): void {
  recognitionStageTimers.forEach((timer) => window.clearTimeout(timer))
  recognitionStageTimers = []
  document.querySelector('[data-screenshot-import-progress]')?.remove()
}

async function cancelScreenshotRecognition(): Promise<void> {
  if (!recognitionPending || recognitionCancelPending) return
  recognitionCancelPending = true
  updateRecognitionProgress('正在停止识别…', '正在安全结束本地识别任务并清理临时文件。')
  const button = document.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
  if (button) {
    button.disabled = true
    button.textContent = '正在取消…'
  }
  try {
    const accepted = await invoke<boolean>('cancel_screenshot_recognition')
    if (!accepted && recognitionPending) {
      updateRecognitionProgress('识别即将完成…', '请稍候，正在生成复核结果。')
    }
  } catch (error) {
    recognitionCancelPending = false
    if (button) {
      button.disabled = false
      button.textContent = '取消识别'
    }
    const surface = document.querySelector<HTMLElement>('.import-review-surface')
    if (surface) setMessage(surface, screenshotImportErrorText(error))
  }
}

"""
replace_once(
    "src/screenshot-import-controller.ts",
    "async function chooseScreenshot(): Promise<void> {\n",
    progress_helpers + "async function chooseScreenshot(): Promise<void> {\n",
)

old_choose = """async function chooseScreenshot(): Promise<void> {
  if (recognitionPending) return
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface) return
  if (!desktopRuntime) {
    setMessage(surface, '浏览器预览不会读取本机图片，请在桌面应用中测试。')
    return
  }

  recognitionPending = true
  setMessage(surface, '正在本机识别课表截图，首次准备 OCR 模型可能需要较长时间…')
  updatePickerState(surface)

  try {
    const draft = await invoke<ImportDraft | null>('choose_and_parse_screenshot')
    if (!draft) {
      setMessage(surface, '已取消选择课表截图。')
      return
    }

    const [settings, schedule] = await Promise.all([
      invoke<AppSettings>('read_app_settings'),
      invoke<ActiveSchedule>('read_schedule'),
    ])
    activeSettings = settings
    activeDraft = draft
    importName = draft.suggestedName
    firstWeekMonday = schedule.semesterStart
    requestId = ''
    refreshImportDraftSummary(draft)
    renderReviewSurface(surface)
  } catch (error) {
    setMessage(surface, screenshotImportErrorText(error))
  } finally {
    recognitionPending = false
    const currentSurface = document.querySelector<HTMLElement>('.import-review-surface')
    if (currentSurface && !activeDraft) updatePickerState(currentSurface)
  }
}
"""
new_choose = """async function chooseScreenshot(): Promise<void> {
  if (recognitionPending) return
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (!surface) return
  if (!desktopRuntime) {
    setMessage(surface, '浏览器预览不会读取本机图片，请在桌面应用中测试。')
    return
  }

  recognitionPending = true
  recognitionCancelPending = false
  setMessage(surface, '')
  showRecognitionProgress(surface)
  updatePickerState(surface)

  try {
    const draft = await invoke<ImportDraft | null>('choose_and_parse_screenshot')
    if (!draft) {
      setMessage(surface, '已取消选择课表截图。')
      return
    }

    updateRecognitionProgress('正在整理课程信息…', '正在组合课程名、周次、节次、地点和教师。')
    const [settings, schedule] = await Promise.all([
      invoke<AppSettings>('read_app_settings'),
      invoke<ActiveSchedule>('read_schedule'),
    ])
    updateRecognitionProgress('正在生成复核结果…', '即将打开课程检查页面。')
    activeSettings = settings
    activeDraft = draft
    importName = draft.suggestedName
    firstWeekMonday = schedule.semesterStart
    requestId = ''
    refreshImportDraftSummary(draft)
    renderReviewSurface(surface)
  } catch (error) {
    const message = screenshotImportErrorText(error)
    setMessage(surface, message.includes('已取消截图识别') ? '已取消识别。' : message)
  } finally {
    recognitionPending = false
    recognitionCancelPending = false
    hideRecognitionProgress()
    const currentSurface = document.querySelector<HTMLElement>('.import-review-surface')
    if (currentSurface && !activeDraft) updatePickerState(currentSurface)
  }
}
"""
replace_once("src/screenshot-import-controller.ts", old_choose, new_choose)

append_once(
    "src/settings.css",
    ".screenshot-import-progress {",
    """
.screenshot-import-progress {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
}
.screenshot-import-progress__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.screenshot-import-progress__heading strong { font-size: 12px; font-weight: 650; }
.screenshot-import-progress__cancel {
  flex: none;
  padding: 4px 8px;
  border: 0;
  border-radius: 7px;
  color: var(--muted);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}
.screenshot-import-progress__cancel:hover:not(:disabled) { background: rgba(31, 35, 40, 0.06); color: #1f2328; }
.screenshot-import-progress__cancel:disabled { cursor: default; opacity: 0.55; }
.screenshot-import-progress__track {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(23, 105, 224, 0.13);
}
.screenshot-import-progress__track span {
  position: absolute;
  inset: 0 auto 0 -38%;
  width: 38%;
  border-radius: inherit;
  background: var(--blue);
  animation: screenshot-import-progress-slide 1.25s ease-in-out infinite;
}
.screenshot-import-progress p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
@keyframes screenshot-import-progress-slide {
  0% { transform: translateX(0); }
  100% { transform: translateX(365%); }
}
@media (prefers-reduced-motion: reduce) {
  .screenshot-import-progress__track span { left: 0; width: 100%; animation: screenshot-import-progress-pulse 1.4s ease-in-out infinite; }
  @keyframes screenshot-import-progress-pulse { 50% { opacity: 0.35; } }
}
""",
)

replace_once(
    "scripts/screenshot-import-dom.test.html",
    "window.__screenshotImportCommands = []",
    """window.__screenshotImportCommands = []
      window.__screenshotRecognitionAttempt = 0
      window.__rejectScreenshotRecognition = null""",
)

replace_once(
    "scripts/screenshot-import-dom.test.html",
    """          if (command === 'choose_and_parse_screenshot') {
            await new Promise((resolve) => setTimeout(resolve, 80))
""",
    """          if (command === 'cancel_screenshot_recognition') {
            const reject = window.__rejectScreenshotRecognition
            window.__rejectScreenshotRecognition = null
            if (reject) reject(new Error('已取消截图识别'))
            return true
          }
          if (command === 'choose_and_parse_screenshot') {
            window.__screenshotRecognitionAttempt += 1
            if (window.__screenshotRecognitionAttempt === 1) {
              return await new Promise((_, reject) => {
                window.__rejectScreenshotRecognition = reject
              })
            }
            await new Promise((resolve) => setTimeout(resolve, 80))
""",
)

old_dom_flow = """  picker.click()
  picker.click()
  await waitFor(
    () => document.querySelector<HTMLElement>('.import-review-surface')?.dataset.screenshotImportMode === 'review',
    'recognized screenshot should enter review mode',
  )
  await waitFor(
    () => document.querySelectorAll('.import-review-toolbar').length === 1,
    'shared review toolbar should render once',
  )

  const recognizeCalls = window.__screenshotImportCommands.filter((command) => command === 'choose_and_parse_screenshot')
  assert(recognizeCalls.length === 1, 'rapid duplicate clicks must start only one recognizer')
"""
new_dom_flow = """  picker.click()
  await waitFor(
    () => document.querySelector('[data-screenshot-import-progress]') !== null,
    'recognition should show an indeterminate progress panel',
  )
  assert(document.querySelector('.screenshot-import-progress__track'), 'recognition should show a moving progress track')
  const cancelButton = document.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
  assert(cancelButton, 'recognition progress should provide a cancel action')
  cancelButton.click()
  await waitFor(
    () => document.querySelector('.surface-message')?.textContent?.includes('已取消识别') === true,
    'cancelled recognition should show a concise result',
  )
  assert(document.querySelector('[data-screenshot-import-progress]') === null, 'cancelled recognition should remove progress UI')
  assert(
    window.__screenshotImportCommands.filter((command) => command === 'cancel_screenshot_recognition').length === 1,
    'cancel action should reach the desktop command once',
  )
  await waitFor(() => picker.disabled === false, 'picker should become available again after cancellation')

  const recognizeCallsBeforeSuccess = window.__screenshotImportCommands
    .filter((command) => command === 'choose_and_parse_screenshot').length
  picker.click()
  picker.click()
  await waitFor(
    () => document.querySelector<HTMLElement>('.import-review-surface')?.dataset.screenshotImportMode === 'review',
    'recognized screenshot should enter review mode',
  )
  await waitFor(
    () => document.querySelectorAll('.import-review-toolbar').length === 1,
    'shared review toolbar should render once',
  )

  const recognizeCalls = window.__screenshotImportCommands.filter((command) => command === 'choose_and_parse_screenshot')
  assert(
    recognizeCalls.length === recognizeCallsBeforeSuccess + 1,
    'rapid duplicate clicks must start only one additional recognizer',
  )
  assert(document.querySelector('[data-screenshot-import-progress]') === null, 'successful recognition should remove progress UI')
"""
replace_once("scripts/screenshot-import-dom.test.ts", old_dom_flow, new_dom_flow)

print("release OCR progress patch applied")
