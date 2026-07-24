# Development Log

## 2026-07-23

- 创建独立 Vite + Vanilla TypeScript 原型仓库。
- 从 `rainmeter-course-schedule/CourseSchedule/@Resources/schedule.json` 复制只读参考数据到 `src/data/schedule.json`。
- 实现可实时调节的开发调试台、六种状态与四种 CSS 桌面背景。
- 实现 `/gallery.html` 统一验收页面。
- 该阶段不包含 Rainmeter 修改、Tauri 初始化或 Windows 桌面行为。

## 2026-07-23 — Visual polish

- 未开学状态改为在日期行直接呈现“学期尚未开始”，不再显示教学周。
- 弱化主状态强调区与组件、Gallery 阴影，并提高次级文字对比度。
- 日期导航改为明确的 `‹ 今 ›` 文本按钮，每个点击区域为 28 × 28 CSS px。

## 2026-07-23 — Tauri desktop shell readiness

- 新增共享渲染模块驱动的 `widget.html`：透明页面只保留最终课表组件，并提供开发期场景查询参数。
- 新增 `web:dev` 与 `web:build` 脚本；浏览器调试台与 Gallery 保持原样。
- 环境检查未发现 Rust/Cargo、Windows C++ Build Tools 与 WebView2 Runtime；遵循范围约束，未安装大型环境、未初始化 Tauri、未实现透明桌面窗口、自适应窗口尺寸、位置持久化或 `alwaysOnBottom`。
- 需在补齐环境后，才能实机验证 150% DPI、窗口层级、拖动、位置恢复与真实 Tauri 截图。

## 2026-07-23 — Tauri desktop shell MVP

- Initialized Tauri 2 in the existing Vite project, retaining the prototype debug desk, `/gallery.html`, and `/widget.html` as independent web entry points.
- Configured the single widget window as transparent, frameless, non-resizable, taskbar-hidden, not always-on-top, and `alwaysOnBottom` without Win32 interop.
- Added a `ResizeObserver` bridge that measures the rendered widget plus a fixed transparent safe area, then sends the resulting CSS dimensions directly as Tauri `LogicalSize`. `scaleFactor` is read only for diagnostics.
- The window begins hidden. The official `tauri-plugin-window-state` is configured with `StateFlags::POSITION` only, so a saved dynamic height is never restored. After font/layout measurement, a small Tauri reveal command shows the window; the official frontend window API remains the safe fallback.
- Confirmed the native development process launches with the MSVC Build Tools environment. The transparent capture surface reflects the window behind it, while the WebView accessibility tree confirms the rendered course content.
- No Rainmeter files were modified. No startup registration, tray, notification, settings window, or desktop-embedding behavior was added.
- The release executable builds successfully. Installer bundling is intentionally disabled for this MVP after WiX and NSIS tool downloads both hit the environment's global timeout.

## 2026-07-23 — Tauri drag-region repair

- The original heading used the standard `data-tauri-drag-region`, which only recognized direct element hits on Windows. Tauri 2.11 `data-tauri-drag-region="deep"` was tested but still selected text rather than moving the window in this WebView2 environment. The window was also explicitly created unfocused, which prevents custom dragging until it gains focus. The widget now restores Tauri's default initial focus and uses the official `getCurrentWindow().startDragging()` fallback on the top non-interactive surface.
- The date-navigation container and all three buttons explicitly opt out with `data-tauri-drag-region="false"`; the 28 × 28 CSS px hit targets remain unchanged.
- Development builds emit a `[widget-drag]` diagnostic showing the pointer target, drag classification, and whether `startDragging()` was called.
- A `0xC000013A` status when Ctrl+C terminates `tauri:dev` is the normal Windows control-C exit and is not an application failure.

## 2026-07-23 — Release visibility repair

- Release used the window configuration default URL (`index.html`) while development explicitly opened `widget.html`. The resulting release page did not import the desktop-shell entry point, so the intentionally hidden widget window never received its ready/show call.
- The production window now explicitly opens `widget.html`. Vite keeps its default root asset base because the generated `/assets/...` URLs were verified to resolve through the Tauri production protocol once the correct page was loaded.
- The frontend now calls `currentWindow.show()` directly after its first render and sizing attempt; every setup step reports its own failure without blocking show. Rust adds a one-time three-second safety fallback that only shows a still-hidden window and recenters a restored off-screen position before that decision.
- The official window-state plugin is registered on the builder before window readiness, persists only `POSITION`, and was verified to write and restore the main window coordinates.

## 2026-07-24 — Daily desktop runtime basics

- Added official Tauri 2 Single Instance, Tray Icon, and Autostart Rust plugins. The single-instance plugin is registered first; a repeat launch only asks the existing widget window to show safely.
- Added the native tray menu: `显示组件`, `隐藏组件`, `开机启动`, and `退出程序`. Left-click toggles visibility, while right-click keeps the native menu behavior.
- The widget close control and normal window close requests now hide to tray. Tray exit sets an explicit quitting flag before using Tauri's normal application exit flow, so the close interception does not trap the process.
- Autostart defaults to disabled and is queried from the operating system in Release builds. Debug builds never enable or disable autostart, preventing a temporary debug executable from being registered.
- Re-showing the widget emits a frontend sync event, reusing the existing live clock and schedule recalculation path without duplicating timers.

## 2026-07-24 — External schedule import and DPI adaptation

- Moved the active Tauri schedule source to AppLocalData with first-run initialization, JSON validation, atomic replacement, up to ten backups, and a `schedule:updated` refresh event.
- Migrated the development machine's existing schedule before replacing the repository source with an anonymous sample; historical commits may still contain the previous private schedule.
- Added official native dialog-based tray import, a schedule-location Explorer action, Chinese success/error feedback, and safe handling for cancel or invalid files.
- Added `onScaleChanged` handling that keeps the 392 logical-pixel width and shares the existing CSS-height sizing flow. This round does not add an installer, notifications, automatic updates, or a graphical schedule editor.

## 2026-07-24 — XLSX parser core

- Added calamine 0.26.1 with a standalone XLSX parser, privacy-minimized intermediate model, week parsing, section parsing, and preview-only section-time conversion.
- Parser locates timetable grids by weekday headings and section rows instead of sheet names or fixed coordinates; entries marked as time-undetermined are silently ignored.
- Verified the ignored local private sample without committing or exposing workbook content. Settings UI, onboarding, preview UI, and confirmed Excel import remain a later integration step.
