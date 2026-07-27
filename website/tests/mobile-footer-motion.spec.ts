import { expect, test } from '@playwright/test'

const homePath = '/desktop-course-widget/'
const introStorageKey = 'course-home:first-mark:v1'

test.describe('mobile footer and motion', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
  })

  test('ends at the legal footer without a trailing blank region', async ({ page }) => {
    await page.goto(homePath, { waitUntil: 'networkidle' })

    const trailingSpace = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>('.course-footer--home-legal')
      if (!footer) return Number.POSITIVE_INFINITY
      const footerBottom = footer.getBoundingClientRect().bottom + window.scrollY
      return document.documentElement.scrollHeight - footerBottom
    })

    expect(trailingSpace).toBeLessThanOrEqual(2)
  })

  test('uses a short staggered upward entrance on phones', async ({ page }) => {
    await page.goto(homePath, { waitUntil: 'networkidle' })
    await page.evaluate((key) => window.sessionStorage.removeItem(key), introStorageKey)
    await page.reload({ waitUntil: 'networkidle' })

    await expect(page.locator('.course-home--orbit')).toHaveClass(/is-intro-playing/)

    const animations = await page.evaluate(() => ({
      mark: getComputedStyle(document.querySelector<HTMLElement>('.orbit-mark img')!).animationName,
      widget: getComputedStyle(document.querySelector<HTMLElement>('.course-stage--orbit')!).animationName,
      settings: getComputedStyle(document.querySelector<HTMLElement>('.orbit-settings')!).animationName,
    }))

    expect(animations.mark).toContain('course-mobile-brand-enter')
    expect(animations.widget).toContain('course-mobile-panel-enter')
    expect(animations.settings).toContain('course-mobile-panel-enter')
  })
})
