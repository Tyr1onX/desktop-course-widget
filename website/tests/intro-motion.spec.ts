import { expect, test } from '@playwright/test'

const introStorageKey = 'course-home:first-mark:v1'
const homePath = '/desktop-course-widget/'

test.describe('homepage motion', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'no-preference',
  })

  test('plays the first mark once per browser session', async ({ page }) => {
    await page.goto(homePath, { waitUntil: 'networkidle' })
    await page.evaluate((key) => window.sessionStorage.removeItem(key), introStorageKey)
    await page.reload({ waitUntil: 'networkidle' })

    const root = page.locator('.course-home--orbit')
    await expect(root).toHaveClass(/is-intro-playing/)
    await expect(page.locator('.orbit-first-mark')).toBeAttached()

    const firstAnimation = await page.locator('.orbit-first-mark__stroke').evaluate((element) =>
      getComputedStyle(element).animationName,
    )
    expect(firstAnimation).toContain('course-first-mark-draw')

    const backgroundAnimation = await root.evaluate((element) =>
      getComputedStyle(element, '::before').animationName,
    )
    expect(backgroundAnimation).toContain('course-time-texture')

    await page.reload({ waitUntil: 'networkidle' })
    await expect(root).toHaveClass(/is-returning/)
    await expect(root).not.toHaveClass(/is-intro-playing/)
  })
})

test.describe('reduced homepage motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('suppresses the opening sequence when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(homePath, { waitUntil: 'networkidle' })

    const firstMarkDisplay = await page.locator('.orbit-first-mark').evaluate((element) =>
      getComputedStyle(element).display,
    )
    expect(firstMarkDisplay).toBe('none')

    const animationDuration = await page.locator('.orbit-mark').evaluate((element) =>
      getComputedStyle(element).animationDuration,
    )
    expect(animationDuration).toMatch(/0\.001ms|0\.000001s/)
  })
})
