from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/widget.ts",
    "  closeControl: boolean\n}",
    "  closeControl: boolean\n  now?: Date\n}",
)
replace_once(
    "src/widget.ts",
    "function liveModel(options: WidgetOptions): WidgetModel {\n  const now = new Date()",
    "function liveModel(options: WidgetOptions): WidgetModel {\n  const now = options.now ? new Date(options.now) : new Date()",
)
replace_once(
    "src/widget.ts",
    "        const today = startOfDay(new Date())",
    "        const today = startOfDay(options.now ?? new Date())",
)

replace_once(
    "src/widget-page.ts",
    "import { PresentationClock, withPresentationDate, type ReplayConfig, type ReplaySnapshot } from './presentation-clock'",
    "import { PresentationClock, type ReplayConfig, type ReplaySnapshot } from './presentation-clock'",
)
replace_once(
    "src/widget-page.ts",
    "let presentationDate: Date | undefined\n",
    "",
)
replace_once(
    "src/widget-page.ts",
    "function renderWidget() {\n  const buildWidget = () => enhanceTimeFlow(createWidget(options, renderWidget), options)\n  app.replaceChildren(presentationDate ? withPresentationDate(presentationDate, buildWidget) : buildWidget())\n}",
    "function renderWidget() {\n  app.replaceChildren(enhanceTimeFlow(createWidget(options, renderWidget), options))\n}",
)
replace_once(
    "src/widget-page.ts",
    "function setPresentationPanelVisible(visible: boolean) {\n  const panel = ensurePresentationPanel()\n  panel.hidden = !visible\n  if (visible) panel.querySelector<HTMLInputElement>('[data-presentation-date]')?.focus()\n}",
    "function setPresentationPanelVisible(visible: boolean) {\n  const panel = ensurePresentationPanel()\n  panel.hidden = !visible\n  document.documentElement.classList.toggle('is-presentation-panel-open', visible)\n  if (visible) panel.querySelector<HTMLInputElement>('[data-presentation-date]')?.focus()\n}",
)
replace_once(
    "src/widget-page.ts",
    "function applyPresentationSnapshot(snapshot: ReplaySnapshot, force = false) {\n  presentationDate = snapshot.date",
    "function applyPresentationSnapshot(snapshot: ReplaySnapshot, force = false) {\n  options.now = snapshot.date",
)
replace_once(
    "src/widget-page.ts",
    "  presentationDate = undefined\n  if (presentationRestore) {",
    "  options.now = undefined\n  if (presentationRestore) {",
)
replace_once(
    "src/widget-page.ts",
    "  presentationDate = undefined\n  renderWidget()",
    "  options.now = undefined\n  renderWidget()",
)

replace_once(
    "src/presentation-clock.ts",
    "export function withPresentationDate<T>(date: Date, work: () => T): T {\n  const NativeDate = globalThis.Date\n  const fixedTimestamp = new NativeDate(date).getTime()\n\n  class PresentationDate extends NativeDate {\n    constructor(...args: unknown[]) {\n      const value = args.length === 0\n        ? new NativeDate(fixedTimestamp)\n        : args.length === 1\n          ? new NativeDate(args[0] as string | number)\n          : new NativeDate(\n              Number(args[0]),\n              Number(args[1]),\n              args[2] === undefined ? 1 : Number(args[2]),\n              args[3] === undefined ? 0 : Number(args[3]),\n              args[4] === undefined ? 0 : Number(args[4]),\n              args[5] === undefined ? 0 : Number(args[5]),\n              args[6] === undefined ? 0 : Number(args[6]),\n            )\n      super(value.getTime())\n    }\n\n    static now(): number {\n      return fixedTimestamp\n    }\n  }\n\n  globalThis.Date = PresentationDate as DateConstructor\n  try {\n    return work()\n  } finally {\n    globalThis.Date = NativeDate\n  }\n}\n\n",
    "",
)

css = Path("src/widget-page.css")
text = css.read_text(encoding="utf-8")
marker = "#app {\n  display: grid;\n  padding: 12px 16px 20px;\n  place-items: start;\n}\n"
addition = marker + "\n.is-presentation-panel-open #app {\n  min-height: 390px;\n}\n"
if ".is-presentation-panel-open #app" not in text:
    if text.count(marker) != 1:
        raise RuntimeError("widget-page.css app block not found exactly once")
    css.write_text(text.replace(marker, addition, 1), encoding="utf-8")
