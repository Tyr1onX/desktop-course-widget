import { expect, test } from '@playwright/test'

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
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.width <= 1024,
      isMobile: viewport.width <= 430,
    })

    test('homepage remains readable and inside the viewport', async ({ page }) => {
      await page.goto('/desktop-course-widget/', { waitUntil: 'networkidle' })

      await expect(page.locator('.course-home--orbit')).toBeVisible()
      await expect(page.locator('#hero-title')).toBeVisible()
      await expect(page.locator('.course-nav__download')).toBeVisible()
      await expect(page.locator('.orbit-hero__actions .course-button--primary')).toBeVisible()
      await expect(page.locator('.orbit-mark img')).toBeVisible()
      await expect(page.locator('.orbit-float--widget')).toBeVisible()
      await expect(page.locator('.orbit-float--settings')).toBeVisible()
      await expect(page.locator('.course-footer--home-legal')).toBeVisible()

      const metrics = await page.evaluate(() => {
        const documentElement = document.documentElement
        const selectors = [
          '.course-nav__inner',
          '.orbit-hero__copy',
          '.orbit-scene',
          '.orbit-float--widget',
          '.orbit-float--settings',
          '.course-footer--home-legal',
        ]

        const bounds = selectors.map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (!element) return { selector, missing: true }
          const rect = element.getBoundingClientRect()
          return {
            selector,
            missing: false,
            left: rect.left,
            right: rect.right,
            width: rect.width,
          }
        })

        const settings = document.querySelector<HTMLElement>('.orbit-settings')?.getBoundingClientRect()
        const settingsFooter = document.querySelector<HTMLElement>('.orbit-settings__editor > footer')?.getBoundingClientRect()
        const days = document.querySelector<HTMLElement>('.orbit-settings__days')?.getBoundingClientRect()
        const courses = Array.from(document.querySelectorAll<HTMLElement>('.orbit-course')).map((course) => {
          const rect = course.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom }
        })
        const dayStyles = Array.from(document.querySelectorAll<HTMLElement>('.orbit-settings__days > span')).map((day) => {
          const style = getComputedStyle(day)
          return { color: style.color, fontWeight: style.fontWeight }
        })

        const primaryButton = document.querySelector<HTMLElement>('.orbit-hero__actions .course-button--primary')?.getBoundingClientRect()
        const navigationDownload = document.querySelector<HTMLElement>('.course-nav__download')?.getBoundingClientRect()

        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth: documentElement.scrollWidth,
          clientWidth: documentElement.clientWidth,
          scrollHeight: documentElement.scrollHeight,
          clientHeight: documentElement.clientHeight,
          bounds,
          settings: settings ? { top: settings.top, bottom: settings.bottom } : null,
          settingsFooter: settingsFooter ? { top: settingsFooter.top, bottom: settingsFooter.bottom } : null,
          daysBottom: days?.bottom ?? null,
          courses,
          dayStyles,
          primaryButtonHeight: primaryButton?.height ?? 0,
          navigationDownloadHeight: navigationDownload?.height ?? 0,
        }
      })

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)

      for (const bound of metrics.bounds) {
        expect(bound.missing, `${bound.selector} should exist`).toBe(false)
        if (bound.missing) continue
        expect(bound.left, `${bound.selector} should not leave the left edge`).toBeGreaterThanOrEqual(-1)
        expect(bound.right, `${bound.selector} should not leave the right edge`).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      }

      expect(metrics.settings).not.toBeNull()
      expect(metrics.settingsFooter).not.toBeNull()
      if (metrics.settings && metrics.settingsFooter) {
        expect(metrics.settingsFooter.top).toBeGreaterThanOrEqual(metrics.settings.top)
        expect(metrics.settingsFooter.bottom).toBeLessThanOrEqual(metrics.settings.bottom + 1)
      }

      expect(metrics.daysBottom).not.toBeNull()
      if (metrics.daysBottom !== null) {
        for (const course of metrics.courses) {
          expect(course.top, 'course cards must start below the date header').toBeGreaterThanOrEqual(metrics.daysBottom - 1)
        }
      }

      expect(new Set(metrics.dayStyles.map((style) => style.color)).size).toBe(1)
      expect(new Set(metrics.dayStyles.map((style) => style.fontWeight)).size).toBe(1)
      expect(metrics.primaryButtonHeight).toBeGreaterThanOrEqual(40)
      expect(metrics.navigationDownloadHeight).toBeGreaterThanOrEqual(32)

      if (viewport.width >= 1101) {
        expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 2)
      }
    })
  })
}
