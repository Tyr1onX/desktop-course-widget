import { expect, test } from '@playwright/test'

const experiencePath = '/desktop-course-widget/experience/'
const hostSelector = '.course-stage--experience .real-widget-host'
const stepSelector = '.course-stage--experience .course-demo-step'

async function openExperience(page: import('@playwright/test').Page) {
  await page.goto(experiencePath, { waitUntil: 'networkidle' })
  await expect(page.locator(hostSelector)).toBeVisible()
  await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('计算机网络')
}

async function pauseAutomaticDemo(page: import('@playwright/test').Page) {
  const toggle = page.locator('.course-stage--experience .course-demo-toggle')
  if (await toggle.textContent() === '暂停') await toggle.click()
  await expect(toggle).toHaveText('继续')
}

async function waitForStableHandoff(page: import('@playwright/test').Page) {
  const host = page.locator(hostSelector)
  await expect(host).toHaveAttribute('data-demo-transition-state', 'idle', { timeout: 12_000 })
  await expect(host).not.toHaveClass(/is-course-handoff-active/)
}

async function expectWeekMeta(
  page: import('@playwright/test').Page,
  weekText: string,
  rangeText: string,
) {
  const footer = page.locator(`${hostSelector} .widget-week-meta`)
  await expect(footer).toHaveCount(1)
  await expect(footer.locator('span').nth(0)).toHaveText(weekText)
  await expect(footer.locator('span').nth(1)).toHaveText(rangeText)
}

async function expectHandoffCleanup(page: import('@playwright/test').Page) {
  const host = page.locator(hostSelector)
  await expect(host.locator([
    '.widget-body-handoff',
    '.course-transition-overlay',
    '.course-shared-morph',
    '.course-shared-float',
    '.course-final-wipe',
    '[data-shared-source-hidden]',
    '.is-shared-copy-hidden',
    '.is-promoting-course',
    '.is-promoting-source',
  ].join(', '))).toHaveCount(0)
  const runningHandoffAnimations = await host.evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.id === 'course-handoff' && animation.playState === 'running').length)
  expect(runningHandoffAnimations).toBe(0)
}

test.describe('teaching week footer handoff', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('keeps one unchanged footer during a same-week course handoff', async ({ page }) => {
    await openExperience(page)
    await pauseAutomaticDemo(page)
    await expectWeekMeta(page, '教学周 3 / 18', '9月21日 – 9月27日')

    await page.evaluate((selector) => {
      const host = document.querySelector<HTMLElement>(selector)!
      const snapshots: Array<{ phase: string; count: number; text: string }> = []
      host.addEventListener('course-handoff:phase', (event) => {
        const phase = (event as CustomEvent<{ phase: string }>).detail.phase
        const footers = host.querySelectorAll<HTMLElement>('.widget-week-meta')
        snapshots.push({
          phase,
          count: footers.length,
          text: footers[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        })
      })
      ;(window as typeof window & { __weekMetaSnapshots?: Array<{ phase: string; count: number; text: string }> }).__weekMetaSnapshots = snapshots
    }, hostSelector)

    await page.locator(stepSelector).nth(1).click()
    await waitForStableHandoff(page)

    await expect(page.locator(`${hostSelector} .focus-course h2`)).toHaveText('概率论')
    await expectWeekMeta(page, '教学周 3 / 18', '9月21日 – 9月27日')
    const snapshots = await page.evaluate(() => (
      window as typeof window & { __weekMetaSnapshots?: Array<{ phase: string; count: number; text: string }> }
    ).__weekMetaSnapshots ?? [])
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.every(({ count }) => count === 1)).toBe(true)
    expect(snapshots.every(({ text }) => text.includes('教学周 3 / 18') && text.includes('9月21日 – 9月27日'))).toBe(true)
    await expectHandoffCleanup(page)
  })

  test('updates the footer when a handoff crosses a teaching-week boundary', async ({ page }) => {
    await openExperience(page)
    await pauseAutomaticDemo(page)
    await expectWeekMeta(page, '教学周 3 / 18', '9月21日 – 9月27日')

    await page.locator(stepSelector).nth(3).click()
    await waitForStableHandoff(page)

    await expect(page.locator(`${hostSelector} .state-label`)).toHaveText('今天无课')
    await expectWeekMeta(page, '教学周 2 / 18', '9月14日 – 9月20日')
    await expectHandoffCleanup(page)
  })

  test('removes and restores the footer without a delayed second height change', async ({ page }) => {
    await openExperience(page)
    await pauseAutomaticDemo(page)
    const host = page.locator(hostSelector)
    await expectWeekMeta(page, '教学周 3 / 18', '9月21日 – 9月27日')

    await page.evaluate((selector) => {
      const host = document.querySelector<HTMLElement>(selector)!
      const phases: string[] = []
      host.addEventListener('course-handoff:phase', (event) => {
        phases.push((event as CustomEvent<{ phase: string }>).detail.phase)
      })
      ;(window as typeof window & { __weekMetaPhases?: string[] }).__weekMetaPhases = phases
    }, hostSelector)

    await page.locator(stepSelector).nth(4).click()
    await waitForStableHandoff(page)
    await expect(page.locator(`${hostSelector} .state-label`)).toHaveText('学期尚未开始')
    await expect(page.locator(`${hostSelector} .widget-week-meta`)).toHaveCount(0)

    const settledHeight = await host.locator('.course-widget').evaluate((widget) => widget.getBoundingClientRect().height)
    await page.waitForTimeout(260)
    const delayedHeight = await host.locator('.course-widget').evaluate((widget) => widget.getBoundingClientRect().height)
    expect(Math.abs(delayedHeight - settledHeight)).toBeLessThanOrEqual(0.5)
    const phases = await page.evaluate(() => (window as typeof window & { __weekMetaPhases?: string[] }).__weekMetaPhases ?? [])
    expect(phases.filter((phase) => phase === 'resizing')).toHaveLength(1)
    await expectHandoffCleanup(page)

    await page.locator(stepSelector).nth(0).click()
    await waitForStableHandoff(page)
    await expectWeekMeta(page, '教学周 3 / 18', '9月21日 – 9月27日')
    await expectHandoffCleanup(page)
  })
})
