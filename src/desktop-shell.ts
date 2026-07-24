import { LogicalSize, getCurrentWindow } from '@tauri-apps/api/window'

const VERTICAL_SAFE_AREA = 32
const FIXED_LOGICAL_WIDTH = 392
const MINIMUM_SIZE = new LogicalSize(FIXED_LOGICAL_WIDTH, 160)
const MAXIMUM_SIZE = new LogicalSize(FIXED_LOGICAL_WIDTH, 740)

function roundDimension(value: number) {
  return Math.round(value * 10) / 10
}

function widgetWindowHeight(widget: HTMLElement) {
  const { height } = widget.getBoundingClientRect()
  return roundDimension(height + VERTICAL_SAFE_AREA)
}

export async function startDesktopShell(app: HTMLDivElement) {
  if (!app.querySelector<HTMLElement>('.course-widget')) return

  const appWindow = getCurrentWindow()
  let lastAppliedHeight: number | undefined
  let resizeFrame: number | undefined

  const applySize = async () => {
    const widget = app.querySelector<HTMLElement>('.course-widget')
    if (!widget) return
    const height = widgetWindowHeight(widget)
    if (lastAppliedHeight !== undefined && Math.abs(lastAppliedHeight - height) < 0.5) return

    await appWindow.setSize(new LogicalSize(FIXED_LOGICAL_WIDTH, height))
    lastAppliedHeight = height

    const scaleFactor = await appWindow.scaleFactor()
    console.info('[desktop-shell] size applied', {
      widgetCss: widget.getBoundingClientRect().toJSON(),
      logical: { width: FIXED_LOGICAL_WIDTH, height },
      physical: {
        width: roundDimension(FIXED_LOGICAL_WIDTH * scaleFactor),
        height: roundDimension(height * scaleFactor),
      },
      scaleFactor,
    })
  }

  const queueSize = () => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      void applySize().catch((error: unknown) => console.error('[desktop-shell] size update failed', error))
    })
  }

  const observer = new ResizeObserver(queueSize)
  // Navigation re-renders the widget element. The stable app container lets
  // us continue to observe its next rendered height without a second bridge.
  observer.observe(app)
  const unlistenScale = await appWindow.onScaleChanged(({ payload }) => {
    console.info('[desktop-shell] scale changed', { scaleFactor: payload.scaleFactor, logicalWidth: FIXED_LOGICAL_WIDTH })
    requestAnimationFrame(queueSize)
  })
  window.addEventListener('beforeunload', () => { observer.disconnect(); unlistenScale() }, { once: true })

  const showWidget = async () => {
    try {
      await appWindow.show()
      console.info('[desktop-shell] widget shown after initial render')
    } catch (error) {
      console.error('[desktop-shell] window show failed', error)
    }
  }

  try {
    await appWindow.setMinSize(MINIMUM_SIZE).catch((error: unknown) => console.error('[desktop-shell] minimum-size setup failed', error))
    await appWindow.setMaxSize(MAXIMUM_SIZE).catch((error: unknown) => console.error('[desktop-shell] maximum-size setup failed', error))
    await document.fonts.ready.catch((error: unknown) => console.error('[desktop-shell] font readiness failed', error))
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await applySize().catch((error: unknown) => console.error('[desktop-shell] initial size update failed', error))
  } finally {
    await showWidget()
  }
}
