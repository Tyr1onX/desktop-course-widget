import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

const VERTICAL_SAFE_AREA = 32
const FIXED_LOGICAL_WIDTH = 392
const MINIMUM_HEIGHT = 160
const MAXIMUM_HEIGHT = 740

type MainWindowMetrics = {
  logicalWidth: number
  logicalHeight: number
  physicalWidth: number
  physicalHeight: number
  scaleFactor: number
}

function roundDimension(value: number) {
  return Math.round(value * 10) / 10
}

function widgetWindowHeight(widget: HTMLElement) {
  const { height } = widget.getBoundingClientRect()
  return roundDimension(Math.min(MAXIMUM_HEIGHT, Math.max(MINIMUM_HEIGHT, height + VERTICAL_SAFE_AREA)))
}

export async function startDesktopShell(app: HTMLDivElement) {
  if (!app.querySelector<HTMLElement>('.course-widget')) return

  const appWindow = getCurrentWindow()
  let lastAppliedHeight: number | undefined
  let pendingHeight: number | undefined
  let resizeFrame: number | undefined
  let sizePump: Promise<void> | undefined
  let resizeDeferredForTransition = false

  const applyHeight = async (height: number) => {
    if (document.documentElement.classList.contains('is-course-transitioning')) {
      resizeDeferredForTransition = true
      return
    }
    if (lastAppliedHeight !== undefined && Math.abs(lastAppliedHeight - height) < 0.5) return

    const metrics = await invoke<MainWindowMetrics>('resize_main_widget', { height })
    lastAppliedHeight = metrics.logicalHeight

    const widget = app.querySelector<HTMLElement>('.course-widget')
    console.info('[desktop-shell] size applied', {
      widgetCss: widget?.getBoundingClientRect().toJSON(),
      logical: { width: metrics.logicalWidth, height: metrics.logicalHeight },
      physical: {
        width: roundDimension(metrics.physicalWidth),
        height: roundDimension(metrics.physicalHeight),
      },
      scaleFactor: metrics.scaleFactor,
    })
  }

  const pumpSizes = () => {
    if (sizePump) return sizePump

    sizePump = (async () => {
      try {
        while (pendingHeight !== undefined) {
          const height = pendingHeight
          pendingHeight = undefined
          await applyHeight(height)
        }
      } finally {
        sizePump = undefined
        if (pendingHeight !== undefined) {
          void pumpSizes().catch((error: unknown) => console.error('[desktop-shell] queued size update failed', error))
        }
      }
    })()

    return sizePump
  }

  const applySize = async () => {
    const widget = app.querySelector<HTMLElement>('.course-widget')
    if (!widget) return
    pendingHeight = widgetWindowHeight(widget)
    await pumpSizes()
  }

  const queueSize = () => {
    if (document.documentElement.classList.contains('is-course-transitioning')) {
      resizeDeferredForTransition = true
      return
    }
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      void applySize().catch((error: unknown) => console.error('[desktop-shell] size update failed', error))
    })
  }

  const applyDeferredTransitionSize = () => {
    if (!resizeDeferredForTransition) return
    resizeDeferredForTransition = false
    queueSize()
  }

  window.addEventListener('course-transition:complete', applyDeferredTransitionSize)
  const observer = new ResizeObserver(queueSize)
  // Navigation and replay can replace internal widget content. Observing the
  // stable app container keeps native window sizing attached to the result.
  observer.observe(app)
  const unlistenScale = await appWindow.onScaleChanged(({ payload }) => {
    console.info('[desktop-shell] scale changed', { scaleFactor: payload.scaleFactor, logicalWidth: FIXED_LOGICAL_WIDTH })
    requestAnimationFrame(queueSize)
  })
  window.addEventListener('beforeunload', () => {
    observer.disconnect()
    window.removeEventListener('course-transition:complete', applyDeferredTransitionSize)
    unlistenScale()
  }, { once: true })

  const showWidget = async () => {
    try {
      await invoke('show_main_widget')
      console.info('[desktop-shell] widget shown after initial render')
    } catch (error) {
      console.error('[desktop-shell] widget show failed', error)
    }
  }

  try {
    await invoke('configure_main_widget').catch((error: unknown) => console.error('[desktop-shell] window bounds setup failed', error))
    await document.fonts.ready.catch((error: unknown) => console.error('[desktop-shell] font readiness failed', error))
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await applySize().catch((error: unknown) => console.error('[desktop-shell] initial size update failed', error))
  } finally {
    await showWidget()
  }
}
