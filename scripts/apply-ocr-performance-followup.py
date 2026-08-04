from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    text = read(path)
    start_index = text.find(start)
    end_index = text.find(end, start_index + len(start))
    if start_index < 0 or end_index < 0:
        raise SystemExit(f"{path}: could not find replacement boundaries")
    write(path, text[:start_index] + replacement + text[end_index:])


# Rust worker: remove a test that depended on private component internals and silence the
# intentionally retained engine metadata field.
worker_path = "src-tauri/src/ocr_worker.rs"
worker = read(worker_path)
worker = worker.replace(
    '    #[serde(default)]\n    engine: Value,',
    '    #[serde(default, rename = "engine")]\n    _engine: Value,',
    1,
)
marker = "\n#[cfg(test)]\nmod tests {"
if marker not in worker:
    raise SystemExit("ocr_worker.rs: private-field test marker not found")
worker = worker.split(marker, 1)[0].rstrip() + "\n"
write(worker_path, worker)

# Isolated runtime CPU policy: use a bounded fraction of available logical processors and
# pass the same value to Paddle, OpenMP, MKL and OpenBLAS.
component_path = "src-tauri/src/ocr_component.rs"
component = read(component_path)
insert_marker = "fn build_isolated_environment(\n"
helper = '''fn isolated_cpu_threads(inherited: &BTreeMap<OsString, OsString>) -> usize {
    let logical = lookup_env(inherited, "NUMBER_OF_PROCESSORS")
        .and_then(|value| value.to_string_lossy().parse::<usize>().ok())
        .unwrap_or(4)
        .max(1);
    if logical <= 2 {
        logical
    } else {
        (logical / 2).clamp(2, 8)
    }
}

'''
if component.count(insert_marker) != 1:
    raise SystemExit("ocr_component.rs: environment helper insertion point changed")
component = component.replace(insert_marker, helper + insert_marker, 1)
old_threads = '    values.insert(OsString::from("OMP_NUM_THREADS"), OsString::from("2"));\n'
new_threads = '''    let cpu_threads = isolated_cpu_threads(inherited).to_string();
    for name in [
        "COURSE_WIDGET_OCR_CPU_THREADS",
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ] {
        values.insert(OsString::from(name), OsString::from(&cpu_threads));
    }
'''
if component.count(old_threads) != 1:
    raise SystemExit("ocr_component.rs: fixed two-thread setting not found")
component = component.replace(old_threads, new_threads, 1)
write(component_path, component)

# Tauri integration and headless worker reuse metrics.
lib_path = "src-tauri/src/lib.rs"
lib = read(lib_path)
lib = lib.replace("mod ocr_diagnostics;\n", "mod ocr_diagnostics;\nmod ocr_worker;\n", 1)
lib = lib.replace("    time::Duration,\n", "    time::{Duration, Instant},\n", 1)
old_struct = '''struct HeadlessOcrSmokeResult {
    ok: bool,
    run_count: usize,
    course_count: usize,
    error: Option<String>,
    diagnostic_id: Option<String>,
    diagnostic_summary: Option<String>,
    component_status: Option<ocr_component::OcrComponentStatus>,
    probe: Option<ocr_component::OcrProbeReport>,
}
'''
new_struct = '''struct HeadlessOcrSmokeResult {
    ok: bool,
    run_count: usize,
    course_count: usize,
    worker_start_count: usize,
    run_durations_ms: Vec<u64>,
    error: Option<String>,
    diagnostic_id: Option<String>,
    diagnostic_summary: Option<String>,
    component_status: Option<ocr_component::OcrComponentStatus>,
    probe: Option<ocr_component::OcrProbeReport>,
}
'''
if lib.count(old_struct) != 1:
    raise SystemExit("lib.rs: headless result struct changed")
lib = lib.replace(old_struct, new_struct, 1)
lib = lib.replace(
    '''fn quit_application(app: &AppHandle) {
    app.state::<RuntimeState>()
        .quitting
        .store(true, Ordering::SeqCst);
    app.exit(0);
}
''',
    '''fn quit_application(app: &AppHandle) {
    app.state::<RuntimeState>()
        .quitting
        .store(true, Ordering::SeqCst);
    screenshot_import::shutdown_worker();
    app.exit(0);
}
''',
    1,
)
lib = lib.replace(
    '''fn intercept_settings_close(app: &AppHandle, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if !app.state::<RuntimeState>().quitting.load(Ordering::SeqCst) {
            api.prevent_close();
            if let Err(error) = app.emit("settings:close-requested", ()) {
''',
    '''fn intercept_settings_close(app: &AppHandle, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if !app.state::<RuntimeState>().quitting.load(Ordering::SeqCst) {
            api.prevent_close();
            screenshot_import::cancel_recognition();
            if let Err(error) = app.emit("settings:close-requested", ()) {
''',
    1,
)
# Every result carries worker metrics; early failures use an empty duration list.
lib = re.sub(
    r"(?m)^(\s+)course_count: ([^\n]+),\n",
    lambda match: (
        f"{match.group(1)}course_count: {match.group(2)},\n"
        f"{match.group(1)}worker_start_count: screenshot_import::worker_start_count(),\n"
        f"{match.group(1)}run_durations_ms: Vec::new(),\n"
    ),
    lib,
)
old_loop = '''        let mut completed_runs = 0;
        let mut last_course_count = 0;
        let mut failure = None;
        for _ in 0..runs {
            match parse_screenshot_path(app_handle.clone(), image.clone()).await {
                Ok(draft) => {
                    completed_runs += 1;
                    last_course_count = draft.courses.len();
                }
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
'''
new_loop = '''        let mut completed_runs = 0;
        let mut last_course_count = 0;
        let mut failure = None;
        let mut run_durations_ms = Vec::new();
        for _ in 0..runs {
            let run_started = Instant::now();
            match parse_screenshot_path(app_handle.clone(), image.clone()).await {
                Ok(draft) => {
                    completed_runs += 1;
                    last_course_count = draft.courses.len();
                }
                Err(error) => {
                    failure = Some(error);
                }
            }
            run_durations_ms.push(
                run_started
                    .elapsed()
                    .as_millis()
                    .min(u128::from(u64::MAX)) as u64,
            );
            if failure.is_some() {
                break;
            }
        }
'''
if lib.count(old_loop) != 1:
    raise SystemExit("lib.rs: headless OCR loop changed")
lib = lib.replace(old_loop, new_loop, 1)
final_start = lib.find("        let result = if let Some(error) = failure {")
final_end = lib.find("        app_handle.exit(exit_code);", final_start)
if final_start < 0 or final_end < 0:
    raise SystemExit("lib.rs: final headless result block not found")
final_block = lib[final_start:final_end]
final_block = final_block.replace(
    "run_durations_ms: Vec::new(),",
    "run_durations_ms: run_durations_ms.clone(),",
)
lib = lib[:final_start] + final_block + lib[final_end:]
lib = lib.replace(
    "        write_headless_result(&result_path, &result);\n        app_handle.exit(exit_code);",
    "        write_headless_result(&result_path, &result);\n        screenshot_import::shutdown_worker();\n        app_handle.exit(exit_code);",
    1,
)
write(lib_path, lib)

# Frontend: real busy lock, readable stop button and elapsed time; remove fake stage timers.
controller_path = "src/screenshot-import-controller.ts"
controller = read(controller_path)
controller = controller.replace(
    "  state: 'ready' | 'missing' | 'corrupt' | 'unavailable'",
    "  state: 'ready' | 'missing' | 'corrupt' | 'runtime-failed' | 'unavailable'",
    1,
)
controller = controller.replace(
    "let recognitionStageTimers: number[] = []",
    "let recognitionElapsedTimer = 0\nlet recognitionStartedAt = 0",
    1,
)
controller = controller.replace(
    "  const blocked = componentState === 'unavailable'",
    "  const blocked = componentState === 'unavailable' || componentState === 'runtime-failed'",
    1,
)
controller = controller.replace(
    "  } else if (componentState === 'unavailable') {",
    "  } else if (componentState === 'runtime-failed') {\n    title = '本地识别运行时检查失败'\n    detail = ocrComponentStatus?.message ?? '请复制诊断信息后反馈'\n  } else if (componentState === 'unavailable') {",
    1,
)
start = "function showRecognitionProgress(surface: HTMLElement): void {"
end = "async function chooseScreenshot(): Promise<void> {"
new_progress = '''function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainder}`
}

function updateRecognitionElapsed(): void {
  const target = document.querySelector<HTMLElement>('[data-screenshot-import-elapsed]')
  if (!target || recognitionStartedAt === 0) return
  const seconds = Math.max(0, (Date.now() - recognitionStartedAt) / 1000)
  target.textContent = `已用时 ${formatElapsed(seconds)}`
}

function setRecognitionBusyState(busy: boolean): void {
  document.body.classList.toggle('is-screenshot-ocr-busy', busy)
  const surface = document.querySelector<HTMLElement>('.import-review-surface')
  if (surface) {
    surface.toggleAttribute('aria-busy', busy)
    surface.dataset.screenshotOcrBusy = busy ? 'true' : 'false'
  }
  const controls = document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('button, input, select, textarea')
  for (const control of controls) {
    if (control.matches('[data-screenshot-import-cancel]')) continue
    if (busy) {
      if (!control.disabled) {
        control.disabled = true
        control.dataset.screenshotOcrDisabled = 'true'
      }
    } else if (control.dataset.screenshotOcrDisabled === 'true') {
      control.disabled = false
      delete control.dataset.screenshotOcrDisabled
    }
  }
}

function showRecognitionProgress(surface: HTMLElement): void {
  let panel = surface.querySelector<HTMLElement>('[data-screenshot-import-progress]')
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'screenshot-import-progress'
    panel.dataset.screenshotImportProgress = 'true'
    panel.setAttribute('aria-live', 'polite')
    panel.innerHTML = `
      <div class="screenshot-import-progress__heading">
        <div>
          <strong data-screenshot-import-progress-title>正在准备本地识别器…</strong>
          <span data-screenshot-import-elapsed>已用时 00:00</span>
        </div>
        <button class="screenshot-import-progress__cancel" type="button" data-screenshot-import-cancel>停止识别</button>
      </div>
      <p data-screenshot-import-progress-detail>图片只在本机处理，不会上传。</p>
    `
    const message = surface.querySelector('.surface-message')
    if (message) message.before(panel)
    else surface.append(panel)
    panel.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
      ?.addEventListener('click', () => void cancelScreenshotRecognition())
  }
  recognitionStartedAt = Date.now()
  window.clearInterval(recognitionElapsedTimer)
  recognitionElapsedTimer = window.setInterval(updateRecognitionElapsed, 1_000)
  updateRecognitionElapsed()
  updateRecognitionProgress('正在准备本地识别器…', '图片只在本机处理，不会上传。')
  setRecognitionBusyState(true)
}

function updateRecognitionProgress(title: string, detail: string): void {
  const panel = document.querySelector<HTMLElement>('[data-screenshot-import-progress]')
  const titleTarget = panel?.querySelector<HTMLElement>('[data-screenshot-import-progress-title]')
  const detailTarget = panel?.querySelector<HTMLElement>('[data-screenshot-import-progress-detail]')
  if (titleTarget) titleTarget.textContent = title
  if (detailTarget) detailTarget.textContent = detail
}

function hideRecognitionProgress(): void {
  window.clearInterval(recognitionElapsedTimer)
  recognitionElapsedTimer = 0
  recognitionStartedAt = 0
  document.querySelector('[data-screenshot-import-progress]')?.remove()
}

async function cancelScreenshotRecognition(): Promise<void> {
  if (!recognitionPending || recognitionCancelPending) return
  recognitionCancelPending = true
  updateRecognitionProgress('正在停止识别…', '正在结束本地识别进程并清理临时文件。')
  const button = document.querySelector<HTMLButtonElement>('[data-screenshot-import-cancel]')
  if (button) {
    button.disabled = true
    button.textContent = '正在停止…'
  }
  try {
    const accepted = await invoke<boolean>('cancel_screenshot_recognition')
    if (!accepted && recognitionPending) {
      updateRecognitionProgress('识别即将完成…', '正在生成复核结果，请稍候。')
    }
  } catch (error) {
    recognitionCancelPending = false
    if (button) {
      button.disabled = false
      button.textContent = '停止识别'
    }
    const surface = document.querySelector<HTMLElement>('.import-review-surface')
    if (surface) setMessage(surface, screenshotImportErrorText(error))
  }
}

'''
start_index = controller.find(start)
end_index = controller.find(end, start_index)
if start_index < 0 or end_index < 0:
    raise SystemExit("screenshot-import-controller.ts: progress block changed")
controller = controller[:start_index] + new_progress + controller[end_index:]
controller = controller.replace(
    "    setMessage(surface, message.includes('已取消截图识别') ? '已取消识别。' : message)",
    "    setMessage(surface, message.includes('已取消') || message.includes('已停止') ? '已停止识别。' : message)",
    1,
)
controller = controller.replace(
    '''  } finally {
    recognitionPending = false
    recognitionCancelPending = false
    hideRecognitionProgress()
''',
    '''  } finally {
    recognitionPending = false
    recognitionCancelPending = false
    setRecognitionBusyState(false)
    hideRecognitionProgress()
''',
    1,
)
write(controller_path, controller)

# Real-stage listener: diagnostic copy is no longer styled as a stop action.
events_path = "src/screenshot-ocr-events.ts"
events = read(events_path)
events = events.replace(
    "    button.className = 'screenshot-import-progress__cancel'",
    "    button.className = 'secondary-button screenshot-ocr-diagnostic-copy'",
    1,
)
write(events_path, events)

# Replace the old indeterminate animation with a clear elapsed-time state and visible stop action.
css_path = "src/settings.css"
css = read(css_path)
old_css = '''.screenshot-import-progress {
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
'''
new_css = '''.screenshot-import-progress {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid #c9d7ea;
  border-radius: 12px;
  background: #f8fbff;
}
.screenshot-import-progress__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.screenshot-import-progress__heading > div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.screenshot-import-progress__heading strong { overflow: hidden; font-size: 13px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
.screenshot-import-progress__heading span { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.screenshot-import-progress__cancel {
  flex: none;
  min-width: 86px;
  height: 34px;
  padding: 0 13px;
  border: 1px solid #d65b5b;
  border-radius: 8px;
  color: #a52f2f;
  background: #fff;
  font-size: 12px;
  font-weight: 620;
  cursor: pointer;
}
.screenshot-import-progress__cancel:hover:not(:disabled) { background: #fff1f1; }
.screenshot-import-progress__cancel:disabled { cursor: wait; opacity: 0.62; }
.screenshot-import-progress p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
body.is-screenshot-ocr-busy .schedule-toolbar,
body.is-screenshot-ocr-busy .schedule-stage { pointer-events: none; user-select: none; }
body.is-screenshot-ocr-busy .surface-close { opacity: 0.35; }
body.is-screenshot-ocr-busy .import-review-surface [data-screenshot-import-cancel] { pointer-events: auto; }
.screenshot-ocr-diagnostic-copy { margin-top: 8px; }
'''
if css.count(old_css) != 1:
    raise SystemExit("settings.css: old progress block changed")
css = css.replace(old_css, new_css, 1)
write(css_path, css)

# Component build: only copy the recursive production runtime closure and bump its identity.
build_path = "scripts/build-ocr-component.ps1"
build = read(build_path)
build = build.replace(
    "[string]$ComponentVersion = 'windows-py31314-paddle331-ocr370-v1'",
    "[string]$ComponentVersion = 'windows-py31314-paddle331-ocr370-mobile-worker-v2'",
    1,
)
build = build.replace(
    "$SmokeScript = Join-Path $RepoRoot 'scripts/ocr-component-smoke.py'",
    "$SmokeScript = Join-Path $RepoRoot 'scripts/ocr-component-smoke.py'\n$RuntimeCopier = Join-Path $RepoRoot 'scripts/copy-ocr-runtime.py'",
    1,
)
build = build.replace(
    "foreach ($requiredFile in @($Requirements, $LockVerifier, $NoticeWriter, $SmokeScript)) {",
    "foreach ($requiredFile in @($Requirements, $LockVerifier, $NoticeWriter, $SmokeScript, $RuntimeCopier)) {",
    1,
)
old_copy = '''  $experimentsTarget = Join-Path $AppRoot 'experiments'
  New-Item -ItemType Directory -Force -Path $experimentsTarget | Out-Null
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'experiments/__init__.py') -Destination $experimentsTarget
  Copy-Item -LiteralPath (Join-Path $RepoRoot 'experiments/screenshot_import') -Destination $experimentsTarget -Recurse
  Remove-Item -LiteralPath (Join-Path $experimentsTarget 'screenshot_import/tests') -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath $AppRoot -Recurse -Directory -Filter '__pycache__' |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath $AppRoot -Recurse -File -Include '*.pyc', '*.pyo' |
    Remove-Item -Force -ErrorAction SilentlyContinue
'''
new_copy = '''  Invoke-Checked -FilePath $BuildPython -ArgumentList @(
    $RuntimeCopier,
    '--source-root', $RepoRoot,
    '--destination-root', $AppRoot
  )
  if (Test-Path -LiteralPath (Join-Path $AppRoot 'experiments/screenshot_import/cli.py')) {
    throw 'Development CLI leaked into the production OCR component.'
  }
'''
if build.count(old_copy) != 1:
    raise SystemExit("build-ocr-component.ps1: source copy block changed")
build = build.replace(old_copy, new_copy, 1)
write(build_path, build)

# Delete the now-unused file-based stage marker. The worker emits real structured stages.
paddle_path = "experiments/screenshot_import/paddle_cpu.py"
paddle = read(paddle_path)
paddle = paddle.replace("import json\n", "", 1)
paddle = paddle.replace("from pathlib import Path\n", "", 1)
paddle = paddle.replace("        self._write_stage_marker()\n", "", 1)
method_start = paddle.find("    def _write_stage_marker(self) -> None:\n")
method_end = paddle.find("    def version_info(self) -> dict[str, str]:\n", method_start)
if method_start < 0 or method_end < 0:
    raise SystemExit("paddle_cpu.py: obsolete stage marker method changed")
paddle = paddle[:method_start] + paddle[method_end:]
write(paddle_path, paddle)

# Production worker skips overlay/grid/token debug output; experiment CLI keeps it by default.
output_path = "experiments/screenshot_import/ocr_first_output.py"
output = read(output_path)
output = output.replace(
    "    draft: dict[str, Any],\n) -> dict[str, str]:",
    "    draft: dict[str, Any],\n    write_diagnostics: bool = True,\n) -> dict[str, str]:",
    1,
)
old_output_body = '''    grid_path.write_text(json.dumps(structure, ensure_ascii=False, indent=2), encoding="utf-8")
    ocr_path.write_text(
        json.dumps(
            {
                "engine": engine,
                "ocrMode": "ocr-first",
                "tokens": [token.to_dict(image_width, image_height) for token in tokens],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    canvas = image.copy()
'''
new_output_body = '''    if not write_diagnostics:
        return {
            "draft": str(draft_path),
            "report": str(report_path),
        }
    grid_path.write_text(json.dumps(structure, ensure_ascii=False, indent=2), encoding="utf-8")
    ocr_path.write_text(
        json.dumps(
            {
                "engine": engine,
                "ocrMode": "ocr-first",
                "tokens": [token.to_dict(image_width, image_height) for token in tokens],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    canvas = image.copy()
'''
if output.count(old_output_body) != 1:
    raise SystemExit("ocr_first_output.py: diagnostics output block changed")
output = output.replace(old_output_body, new_output_body, 1)
write(output_path, output)

pipeline_path = "experiments/screenshot_import/ocr_first_pipeline.py"
pipeline = read(pipeline_path)
pipeline = pipeline.replace(
    "    stage_callback: StageCallback | None = None,\n) -> dict[str, Any]:",
    "    stage_callback: StageCallback | None = None,\n    write_diagnostics: bool = True,\n) -> dict[str, Any]:",
    1,
)
pipeline = pipeline.replace(
    "        draft=draft,\n    )",
    "        draft=draft,\n        write_diagnostics=write_diagnostics,\n    )",
    1,
)
write(pipeline_path, pipeline)

worker_py_path = "experiments/screenshot_import/worker.py"
worker_py = read(worker_py_path)
worker_py = worker_py.replace(
    "        stage_callback=stage_callback,\n    )",
    "        stage_callback=stage_callback,\n        write_diagnostics=False,\n    )",
    1,
)
write(worker_py_path, worker_py)

print("OCR performance follow-up patch applied")
