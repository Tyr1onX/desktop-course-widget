import { expect, test } from '@playwright/test'

const experiencePath = '/desktop-course-widget/experience/'
const hostSelector = '.course-stage--experience .real-widget-host'
const stepSelector = '.course-stage--experience .course-demo-step'

async function openExperience(page: import('@playwright/test').Page) {
  await page.goto(experiencePath, { waitUntil: 'networkidle' })
  await expect(page.locator(hostSelector)).toBeVisible()
  await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('计算机网络')
}

async function waitForStableHandoff(page: import('@playwright/test').Page) {
  await expect(page.locator(hostSelector)).toHaveAttribute('data-demo-transition-state', 'idle', { timeout: 12_000 })
  await expect(page.locator(`${hostSelector}.is-course-handoff-active`)).toHaveCount(0)
}

async function pauseAutomaticDemo(page: import('@playwright/test').Page) {
  const toggle = page.locator('.course-stage--experience .course-demo-toggle')
  if (await toggle.textContent() === '暂停') await toggle.click()
  await expect(toggle).toHaveText('继续')
}

async function installGeometryTrace(page: import('@playwright/test').Page) {
  await page.evaluate((selector) => {
    const host = document.querySelector<HTMLElement>(selector)!
    const widget = host.querySelector<HTMLElement>('.course-widget')!
    const phases: Array<{ phase: string; time: number; height: number }> = []
    const sizes: Array<{ time: number; height: number }> = []
    const measure = () => (host.querySelector<HTMLElement>('.widget-body-handoff')
      ?? host.querySelector<HTMLElement>('.widget-body'))?.getBoundingClientRect().height ?? 0
    const observer = new ResizeObserver(() => {
      sizes.push({ time: performance.now(), height: widget.getBoundingClientRect().height })
    })
    observer.observe(widget)
    sizes.push({ time: performance.now(), height: widget.getBoundingClientRect().height })
    host.addEventListener('course-handoff:phase', (event) => {
      const phase = (event as CustomEvent<{ phase: string }>).detail.phase
      phases.push({ phase, time: performance.now(), height: measure() })
    })
    ;(window as typeof window & {
      __courseGeometryTrace?: {
        phases: Array<{ phase: string; time: number; height: number }>
        sizes: Array<{ time: number; height: number }>
      }
    }).__courseGeometryTrace = { phases, sizes }
  }, hostSelector)
}

async function readGeometryTrace(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as typeof window & {
    __courseGeometryTrace?: {
      phases: Array<{ phase: string; time: number; height: number }>
      sizes: Array<{ time: number; height: number }>
    }
  }).__courseGeometryTrace ?? { phases: [], sizes: [] })
}

async function expectEmptyState(page: import('@playwright/test').Page) {
  await expect(page.locator(`${hostSelector} .state-label`)).toHaveText('今天无课')
  await expect(page.locator(`${hostSelector} .focus-kicker`)).toHaveText('下一次课程')
  await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('计算机网络')
  await expect(page.locator(`${hostSelector} .course-time`)).toHaveText('08:00–09:40')
  await expect(page.locator(`${hostSelector} .course-location`)).toHaveText('教学楼 A101')
}

test.describe('shared course handoff', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('promotes a following course and transfers text ownership before resizing', async ({ page }) => {
    await openExperience(page)

    await page.evaluate((selector) => {
      const host = document.querySelector<HTMLElement>(selector)!
      const phases: string[] = []
      const snapshots: Record<string, unknown>[] = []
      host.addEventListener('course-handoff:phase', (event) => {
        const phase = (event as CustomEvent<{ phase: string }>).detail.phase
        phases.push(phase)
        snapshots.push({
          phase,
          floats: host.querySelectorAll('.course-shared-float').length,
          hiddenSources: host.querySelectorAll('[data-shared-source-hidden="true"]').length,
          hiddenTargets: host.querySelectorAll('.is-shared-copy-hidden').length,
          hiddenFloats: Array.from(host.querySelectorAll<HTMLElement>('.course-shared-float'))
            .filter((element) => getComputedStyle(element).visibility === 'hidden').length,
          overlay: host.querySelectorAll('.course-transition-overlay').length,
          morph: host.querySelectorAll('.course-shared-morph').length,
        })
      })
      ;(window as typeof window & { __handoffPhases?: string[] }).__handoffPhases = phases
      ;(window as typeof window & { __handoffSnapshots?: Record<string, unknown>[] }).__handoffSnapshots = snapshots
    }, hostSelector)

    await page.locator(stepSelector).nth(1).click()
    await expect(page.locator(`${hostSelector} .course-transition-overlay`)).toBeVisible({ timeout: 5_000 })
    await waitForStableHandoff(page)

    await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('概率论')
    await expect(page.locator(`${hostSelector} .course-transition-overlay`)).toHaveCount(0)
    await expect(page.locator(`${hostSelector} .course-shared-morph`)).toHaveCount(0)
    await expect(page.locator(`${hostSelector} .course-shared-float`)).toHaveCount(0)
    await expect(page.locator(`${hostSelector} [data-shared-source-hidden]`)).toHaveCount(0)
    await expect(page.locator(`${hostSelector} .is-shared-copy-hidden`)).toHaveCount(0)
    await expect(page.locator(`${hostSelector} .is-promoting-course, ${hostSelector} .is-promoting-source`)).toHaveCount(0)

    const trace = await page.evaluate(() => ({
      phases: (window as typeof window & { __handoffPhases?: string[] }).__handoffPhases ?? [],
      snapshots: (window as typeof window & { __handoffSnapshots?: Record<string, unknown>[] }).__handoffSnapshots ?? [],
    }))

    expect(trace.phases).toContain('shared-source-matched')
    expect(trace.phases.indexOf('shared-text-moving')).toBeLessThan(trace.phases.indexOf('ownership-transferred'))
    expect(trace.phases.indexOf('ownership-transferred')).toBeLessThan(trace.phases.indexOf('content-installed'))
    expect(trace.phases.indexOf('content-installed')).toBeLessThan(trace.phases.indexOf('resizing'))
    expect(trace.phases.at(-1)).toBe('complete')

    const moving = trace.snapshots.find((snapshot) => snapshot.phase === 'shared-text-moving')
    expect(moving).toMatchObject({ floats: 3, hiddenSources: 3, hiddenTargets: 3, overlay: 1, morph: 1 })
    const transferred = trace.snapshots.find((snapshot) => snapshot.phase === 'ownership-transferred')
    expect(transferred).toMatchObject({ floats: 3, hiddenFloats: 3, hiddenTargets: 0, overlay: 1, morph: 1 })
    const complete = trace.snapshots.find((snapshot) => snapshot.phase === 'complete')
    expect(complete).toMatchObject({ floats: 0, hiddenSources: 0, hiddenTargets: 0, overlay: 0, morph: 0 })
  })

  test('couples compound empty-state entry with one height settle', async ({ page }) => {
    await openExperience(page)
    await pauseAutomaticDemo(page)
    await page.locator(stepSelector).nth(1).click()
    await waitForStableHandoff(page)
    await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('概率论')

    await installGeometryTrace(page)
    await page.locator(stepSelector).nth(3).click()
    await waitForStableHandoff(page)
    await expectEmptyState(page)

    const settledHeight = await page.locator(`${hostSelector} .course-widget`).evaluate((widget) => widget.getBoundingClientRect().height)
    await page.waitForTimeout(220)
    const delayedHeight = await page.locator(`${hostSelector} .course-widget`).evaluate((widget) => widget.getBoundingClientRect().height)
    const trace = await readGeometryTrace(page)
    const phaseNames = trace.phases.map(({ phase }) => phase)
    const installed = trace.phases.find(({ phase }) => phase === 'content-installed')!
    const resizing = trace.phases.find(({ phase }) => phase === 'resizing')!
    const complete = trace.phases.find(({ phase }) => phase === 'complete')!

    expect(phaseNames.filter((phase) => phase === 'resizing')).toHaveLength(1)
    expect(resizing.time - installed.time).toBeLessThan(80)
    expect(Math.abs(resizing.height - installed.height)).toBeLessThanOrEqual(1)
    expect(complete.time).toBeGreaterThan(resizing.time)
    expect(Math.abs(delayedHeight - settledHeight)).toBeLessThanOrEqual(0.5)

    const lateSizes = trace.sizes.filter(({ time }) => time > complete.time + 32)
    expect(lateSizes.every(({ height }) => Math.abs(height - settledHeight) <= 0.5)).toBe(true)
  })

  test('keeps stable-sync empty state free of a delayed second geometry change', async ({ page }) => {
    await openExperience(page)
    await pauseAutomaticDemo(page)
    await installGeometryTrace(page)

    await page.locator(stepSelector).nth(3).click()
    await waitForStableHandoff(page)
    await expectEmptyState(page)

    const firstHeight = await page.locator(`${hostSelector} .course-widget`).evaluate((widget) => widget.getBoundingClientRect().height)
    await page.waitForTimeout(520)
    const finalHeight = await page.locator(`${hostSelector} .course-widget`).evaluate((widget) => widget.getBoundingClientRect().height)
    const trace = await readGeometryTrace(page)
    const phaseNames = trace.phases.map(({ phase }) => phase)

    expect(phaseNames).toContain('stable-sync')
    expect(phaseNames).not.toContain('resizing')
    await expect(page.locator(`${hostSelector} .widget-body-handoff`)).toHaveCount(0)
    expect(Math.abs(finalHeight - firstHeight)).toBeLessThanOrEqual(0.5)
  })

  test('rapid requests cancel stale transitions and settle on the latest target', async ({ page }) => {
    await openExperience(page)

    await page.locator(stepSelector).nth(1).click()
    await expect(page.locator(`${hostSelector}.is-course-handoff-active`)).toHaveCount(1)
    await page.locator(stepSelector).nth(2).click()
    await page.locator(stepSelector).nth(3).click()

    await waitForStableHandoff(page)
    await expect(page.locator(`${hostSelector} .state-label`)).toHaveText('今天无课')
    await expect(page.locator(`${hostSelector} .course-transition-overlay, ${hostSelector} .course-shared-morph, ${hostSelector} .course-shared-float`)).toHaveCount(0)
    await expect(page.locator(`${hostSelector} [data-shared-source-hidden], ${hostSelector} .is-shared-copy-hidden`)).toHaveCount(0)
    const runningHandoffAnimations = await page.locator(hostSelector).evaluate((host) => host.getAnimations({ subtree: true })
      .filter((animation) => animation.id === 'course-handoff' && animation.playState === 'running').length)
    expect(runningHandoffAnimations).toBe(0)
  })

  test('automatic rotation is armed only after the handoff completes', async ({ page }) => {
    await openExperience(page)
    await expect(page.locator(hostSelector)).toHaveAttribute('data-demo-timer-state', 'scheduled')

    await page.locator(stepSelector).nth(1).click()
    await expect(page.locator(hostSelector)).toHaveAttribute('data-demo-transition-state', 'running')
    await expect(page.locator(hostSelector)).toHaveAttribute('data-demo-timer-state', 'idle')
    await page.mouse.move(0, 0)

    await waitForStableHandoff(page)
    await expect(page.locator(hostSelector)).toHaveAttribute('data-demo-timer-state', 'scheduled')
    await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('概率论')
  })

  test('visibility, hover, and manual pause control the next stable timer', async ({ page }) => {
    await openExperience(page)
    const host = page.locator(hostSelector)
    const stage = page.locator('.course-stage--experience')
    const toggle = page.locator('.course-stage--experience .course-demo-toggle')

    await stage.hover()
    await expect(host).toHaveAttribute('data-demo-timer-state', 'idle')
    await page.mouse.move(0, 0)
    await expect(host).toHaveAttribute('data-demo-timer-state', 'scheduled')

    await toggle.click()
    await expect(toggle).toHaveText('继续')
    await expect(host).toHaveAttribute('data-demo-timer-state', 'idle')
    await toggle.click()
    await expect(toggle).toHaveText('暂停')
    await stage.dispatchEvent('mouseleave')
    await expect(host).toHaveAttribute('data-demo-timer-state', 'scheduled')

    await page.locator(stepSelector).nth(1).click()
    await expect(page.locator(`${hostSelector}.is-course-handoff-active`)).toHaveCount(1)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(host).toHaveAttribute('data-demo-transition-state', 'idle')
    await expect(host).toHaveAttribute('data-demo-timer-state', 'idle')
    await expect(page.locator(`${hostSelector} .course-transition-overlay, ${hostSelector} .course-shared-morph, ${hostSelector} .course-shared-float, ${hostSelector} [data-shared-source-hidden], ${hostSelector} .is-shared-copy-hidden`)).toHaveCount(0)

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await stage.dispatchEvent('mouseleave')
    await expect(host).toHaveAttribute('data-demo-timer-state', 'scheduled')
  })

  test('route cleanup cancels the active handoff and clears its timer state', async ({ page }) => {
    await openExperience(page)
    await page.locator(stepSelector).nth(1).click()
    await expect(page.locator(`${hostSelector}.is-course-handoff-active`)).toHaveCount(1)

    await page.evaluate((selector) => {
      ;(window as typeof window & { __detachedDemoHost?: HTMLElement }).__detachedDemoHost = document.querySelector<HTMLElement>(selector) ?? undefined
    }, hostSelector)
    await page.locator('.course-brand').click()
    await expect(page.locator('.course-home')).toBeVisible()

    const cleanup = await page.evaluate(() => {
      const host = (window as typeof window & { __detachedDemoHost?: HTMLElement }).__detachedDemoHost
      return {
        connected: host?.isConnected ?? false,
        active: host?.classList.contains('is-course-handoff-active') ?? false,
        timer: host?.dataset.demoTimerState ?? '',
        transition: host?.dataset.demoTransitionState ?? '',
        transient: host?.querySelectorAll('.course-transition-overlay, .course-shared-morph, .course-shared-float, [data-shared-source-hidden], .is-shared-copy-hidden').length ?? -1,
        runningAnimations: host?.getAnimations({ subtree: true })
          .filter((animation) => animation.id === 'course-handoff' && animation.playState === 'running').length ?? -1,
      }
    })
    expect(cleanup).toEqual({
      connected: false,
      active: false,
      timer: 'idle',
      transition: 'idle',
      transient: 0,
      runningAnimations: 0,
    })
  })

  test('handoff layers remain clipped to the widget at required widths', async ({ page }) => {
    test.setTimeout(90_000)
    const viewports = [
      { width: 1440, height: 900 },
      { width: 820, height: 1180 },
      { width: 430, height: 932 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await openExperience(page)
      await page.locator(stepSelector).nth(1).click()
      await expect(page.locator(`${hostSelector} .course-transition-overlay`)).toBeVisible({ timeout: 5_000 })

      const metrics = await page.evaluate((selector) => {
        const host = document.querySelector<HTMLElement>(selector)!
        const widget = host.querySelector<HTMLElement>('.course-widget')!
        const overlay = host.querySelector<HTMLElement>('.course-transition-overlay')!
        const controls = document.querySelector<HTMLElement>('.course-stage--experience .course-demo-controls')!
        const widgetRect = widget.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        const controlRects = Array.from(controls.querySelectorAll<HTMLElement>('button')).map((button) => button.getBoundingClientRect())
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          widget: { left: widgetRect.left, right: widgetRect.right, top: widgetRect.top, bottom: widgetRect.bottom },
          overlay: { left: overlayRect.left, right: overlayRect.right, top: overlayRect.top, bottom: overlayRect.bottom },
          controls: controlRects.map((rect) => ({ width: rect.width, height: rect.height })),
        }
      }, hostSelector)

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
      expect(metrics.overlay.left).toBeGreaterThanOrEqual(metrics.widget.left - 1)
      expect(metrics.overlay.right).toBeLessThanOrEqual(metrics.widget.right + 1)
      expect(metrics.overlay.top).toBeGreaterThanOrEqual(metrics.widget.top - 1)
      expect(metrics.overlay.bottom).toBeLessThanOrEqual(metrics.widget.bottom + 1)
      expect(metrics.controls.every((control) => control.width > 0 && control.height > 0)).toBe(true)

      await waitForStableHandoff(page)
      const stableOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(stableOverflow).toBeLessThanOrEqual(1)
    }
  })
})

test.describe('reduced course motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('replaces the widget directly without overlays or hidden copies', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openExperience(page)
    expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)

    await page.evaluate((selector) => {
      const host = document.querySelector<HTMLElement>(selector)!
      const phases: string[] = []
      host.addEventListener('course-handoff:phase', (event) => {
        phases.push((event as CustomEvent<{ phase: string }>).detail.phase)
      })
      ;(window as typeof window & { __reducedPhases?: string[] }).__reducedPhases = phases
    }, hostSelector)

    await page.locator(stepSelector).nth(1).click()
    await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('概率论')
    await expect(page.locator(`${hostSelector}.is-course-handoff-active`)).toHaveCount(0)
    await expect(page.locator(`${hostSelector} .course-transition-overlay, ${hostSelector} .course-shared-morph, ${hostSelector} .course-shared-float, ${hostSelector} [data-shared-source-hidden], ${hostSelector} .is-shared-copy-hidden`)).toHaveCount(0)

    const phases = await page.evaluate(() => (window as typeof window & { __reducedPhases?: string[] }).__reducedPhases ?? [])
    expect(phases).toContain('reduced-motion')
    expect(phases).not.toContain('shared-text-moving')
  })
})
