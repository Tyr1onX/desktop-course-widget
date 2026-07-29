import { expect, test } from '@playwright/test'

const experiencePath = '/desktop-course-widget/experience/'
const viewports = [
  { name: 'desktop-large', width: 1920, height: 1080 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
  { name: 'phone-large', width: 430, height: 932 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-small', width: 360, height: 800 },
]

for (const viewport of viewports) {
  test.describe(`experience ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.width <= 1024,
      isMobile: viewport.width <= 430,
      reducedMotion: 'reduce',
    })

    test('keeps the consolidated content readable and interactive', async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      page.on('pageerror', (error) => consoleErrors.push(error.message))

      await page.goto(experiencePath, { waitUntil: 'networkidle' })

      await expect(page.locator('.course-experience')).toBeVisible()
      await expect(page.locator('#experience-title')).toHaveText('课表会自己来到此刻。')
      await expect(page.locator('.course-stage--experience .course-demo-step')).toHaveCount(6)
      await expect(page.locator('.course-stage--experience .course-demo-toggle')).toBeVisible()
      await expect(page.locator('#day-flow, .day-flow, .day-moment')).toHaveCount(0)
      await expect(page.locator('#import-title')).toHaveText('导入一次，整个学期都在。')
      await expect(page.locator('.experience-import__steps article')).toHaveCount(3)
      await expect(page.locator('#focus-title')).toHaveText('需要时看见，不需要时隐去。')
      await expect(page.locator('#privacy-title')).toHaveText('无需账号，不上传课表。')

      const toggle = page.locator('.course-stage--experience .course-demo-toggle')
      await toggle.click()
      await expect(toggle).toHaveText('继续')
      await toggle.click()
      await expect(toggle).toHaveText('暂停')

      const desktop = page.locator('.focus-desktop')
      await desktop.scrollIntoViewIfNeeded()
      await page.locator('.focus-desktop__widget [data-hide]').click()
      await expect(desktop).toHaveClass(/is-widget-hidden/)
      await page.locator('.focus-desktop__tray-app').click({ force: true })
      await expect(desktop).not.toHaveClass(/is-widget-hidden/)

      const metrics = await page.evaluate(() => {
        const selectors = [
          '.course-nav__inner',
          '.experience-hero__copy',
          '.course-stage--experience',
          '.experience-import__heading',
          '.experience-import__steps',
          '.course-focus__inner',
          '.course-focus__visual',
          '.experience-privacy',
          '.experience-closing',
          '.course-footer',
        ]
        const bounds = selectors.map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (!element) return { selector, missing: true, left: 0, right: 0, width: 0 }
          const rect = element.getBoundingClientRect()
          return { selector, missing: false, left: rect.left, right: rect.right, width: rect.width }
        })
        const layoutTop = (element: HTMLElement) => {
          let top = 0
          let current: HTMLElement | null = element
          while (current) {
            top += current.offsetTop
            current = current.offsetParent as HTMLElement | null
          }
          return top
        }
        const sectionSelectors = [
          '.experience-hero',
          '.experience-import',
          '.experience-focus',
          '.experience-privacy',
          '.experience-closing',
        ]
        const sections = sectionSelectors.map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)!
          const top = layoutTop(element)
          return { selector, top, bottom: top + element.offsetHeight }
        })
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          bounds,
          sections,
          navLinks: Array.from(document.querySelectorAll<HTMLAnchorElement>('.course-nav__links a')).map((link) => link.getAttribute('href')),
          guideHref: document.querySelector<HTMLAnchorElement>('.experience-import__heading > a')?.getAttribute('href') ?? '',
          faqHref: document.querySelector<HTMLAnchorElement>('.experience-privacy > a')?.getAttribute('href') ?? '',
        }
      })

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
      for (const bound of metrics.bounds) {
        expect(bound.missing, `${bound.selector} should exist`).toBe(false)
        if (bound.missing) continue
        expect(bound.left, `${bound.selector} should not leave the left edge`).toBeGreaterThanOrEqual(-1)
        expect(bound.right, `${bound.selector} should not leave the right edge`).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      }
      for (let index = 1; index < metrics.sections.length; index += 1) {
        expect(metrics.sections[index].top).toBeGreaterThanOrEqual(metrics.sections[index - 1].bottom - 1)
        expect(metrics.sections[index].top - metrics.sections[index - 1].bottom).toBeLessThanOrEqual(2)
      }
      expect(metrics.navLinks).toEqual([
        '/desktop-course-widget/',
        '#import-edit',
        '#desktop-behavior',
      ])
      expect(metrics.guideHref).toContain('/guide/getting-started')
      expect(metrics.faqHref).toContain('/help/faq')
      if (viewport.width >= 1024) {
        expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight * 5)
      }
      expect(consoleErrors).toEqual([])
    })
  })
}
