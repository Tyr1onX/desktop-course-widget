import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

    test('keeps one core expression readable and interactive', async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      page.on('pageerror', (error) => consoleErrors.push(error.message))

      await page.goto(experiencePath, { waitUntil: 'networkidle' })

      await expect(page.locator('.course-experience')).toBeVisible()
      await expect(page.locator('#experience-title .experience-title__line')).toHaveCount(2)
      await expect(page.locator('#experience-title .experience-title__line').nth(0)).toHaveText('课表不必摊开一整天。')
      await expect(page.locator('#experience-title .experience-title__line').nth(1)).toHaveText('此刻，只看这一课。')
      await expect(page.locator('.experience-hero__lead')).toHaveText('课程会随着时间自然交接，下一节也会在需要时来到眼前。')
      await expect(page.locator('.course-stage--experience .course-demo-step')).toHaveCount(6)
      await expect(page.locator('.course-stage--experience .course-demo-toggle')).toBeVisible()
      await expect(page.locator('.experience-capabilities__line')).toHaveCount(2)
      await expect(page.locator('#import-edit, #desktop-behavior, #privacy, .experience-import, .experience-focus, .experience-privacy, .experience-closing, .focus-desktop')).toHaveCount(0)
      await expect(page.locator('.course-stage__chrome, .course-stage__signal, .course-stage__battery, .course-stage__dock, .course-stage__light--two')).toHaveCount(0)
      await expect(page.locator('.course-stage--experience .course-stage__light')).toHaveCount(1)

      const toggle = page.locator('.course-stage--experience .course-demo-toggle')
      await toggle.click()
      await expect(toggle).toHaveText('继续')
      await toggle.click()
      await expect(toggle).toHaveText('暂停')

      const steps = page.locator('.course-demo-step')
      for (let index = 0; index < 6; index += 1) {
        await steps.nth(index).click()
        await expect(steps.nth(index)).toHaveAttribute('aria-current', 'true')
        await page.waitForFunction(() => document.querySelector<HTMLElement>('.real-widget-host')?.dataset.demoTransitionState === 'idle')

        const spacing = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
          const stageRect = rect('.course-stage--experience')!
          const statusRect = rect('.course-demo-status')!
          const hostRect = rect('.real-widget-host')!
          const controlsRect = rect('.course-demo-controls')!
          return {
            statusGap: hostRect.top - statusRect.bottom,
            controlsGap: controlsRect.top - hostRect.bottom,
            controlsBottomGap: stageRect.bottom - controlsRect.bottom,
          }
        })

        expect(spacing.statusGap, `state ${index} status should not touch the widget`).toBeGreaterThanOrEqual(12)
        expect(spacing.controlsGap, `state ${index} controls should not overlap the widget`).toBeGreaterThanOrEqual(12)
        expect(spacing.controlsBottomGap, `state ${index} controls should keep a stage inset`).toBeGreaterThanOrEqual(14)
      }

      const metrics = await page.evaluate(() => {
        const layoutPosition = (element: HTMLElement) => {
          let left = 0
          let top = 0
          let current: HTMLElement | null = element
          while (current) {
            left += current.offsetLeft
            top += current.offsetTop
            current = current.offsetParent as HTMLElement | null
          }
          return { left, top }
        }
        const textLineCount = (element: HTMLElement) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return range.getClientRects().length
        }
        const selectors = [
          '.course-nav__inner',
          '.experience-hero__copy',
          '.course-stage--experience',
          '.experience-capabilities',
          '.experience-footer',
        ]
        const bounds = selectors.map((selector) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (!element) return { selector, missing: true, left: 0, right: 0 }
          const { left } = layoutPosition(element)
          return { selector, missing: false, left, right: left + element.offsetWidth }
        })
        const hero = document.querySelector<HTMLElement>('.experience-hero')!
        const footer = document.querySelector<HTMLElement>('.experience-footer')!
        const stage = document.querySelector<HTMLElement>('.course-stage--experience')!
        const heroPosition = layoutPosition(hero)
        const footerPosition = layoutPosition(footer)
        const stageStyle = getComputedStyle(stage)
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          scrollX: window.scrollX,
          bounds,
          titleLineCounts: Array.from(document.querySelectorAll<HTMLElement>('.experience-title__line')).map(textLineCount),
          leadLineCounts: Array.from(document.querySelectorAll<HTMLElement>('.experience-hero__lead span')).map(textLineCount),
          heroBottom: heroPosition.top + hero.offsetHeight,
          footerTop: footerPosition.top,
          stageHeight: stage.getBoundingClientRect().height,
          stageBackground: stageStyle.backgroundImage,
          navLinks: Array.from(document.querySelectorAll<HTMLAnchorElement>('.course-nav__links a')).map((link) => link.getAttribute('href')),
          downloadHref: document.querySelector<HTMLAnchorElement>('.experience-hero .course-button--primary')?.getAttribute('href') ?? '',
          guideHref: document.querySelector<HTMLAnchorElement>('.experience-hero .course-button--text')?.getAttribute('href') ?? '',
          faqHref: document.querySelector<HTMLAnchorElement>('.experience-footer a[href*="/help/faq"]')?.getAttribute('href') ?? '',
          githubHref: document.querySelector<HTMLAnchorElement>('.experience-footer a[href*="github.com"]')?.getAttribute('href') ?? '',
          homeHref: document.querySelector<HTMLAnchorElement>('.experience-footer a[href="/desktop-course-widget/"]')?.getAttribute('href') ?? '',
        }
      })

      expect(metrics.scrollX).toBe(0)
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
      expect(metrics.titleLineCounts).toEqual([1, 1])
      expect(metrics.leadLineCounts).toEqual([1, 1])
      expect(metrics.footerTop).toBeGreaterThanOrEqual(metrics.heroBottom - 1)
      expect(metrics.footerTop - metrics.heroBottom).toBeLessThanOrEqual(2)
      expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight * 2.35)
      expect(metrics.stageHeight).toBeLessThanOrEqual(viewport.width <= 760 ? 562 : 602)
      expect((metrics.stageBackground.match(/gradient/g) ?? []).length).toBe(1)
      for (const bound of metrics.bounds) {
        expect(bound.missing, `${bound.selector} should exist`).toBe(false)
        if (bound.missing) continue
        expect(bound.left, `${bound.selector} should not leave the left edge`).toBeGreaterThanOrEqual(-1)
        expect(bound.right, `${bound.selector} should not leave the right edge`).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      }
      expect(metrics.navLinks).toEqual([
        '/desktop-course-widget/',
        '/desktop-course-widget/guide/getting-started',
        '/desktop-course-widget/help/faq',
      ])
      expect(metrics.downloadHref).toContain('/releases/latest')
      expect(metrics.guideHref).toContain('/guide/getting-started')
      expect(metrics.faqHref).toContain('/help/faq')
      expect(metrics.githubHref).toBe('https://github.com/Tyr1onX/desktop-course-widget')
      expect(metrics.homeHref).toBe('/desktop-course-widget/')
      expect(consoleErrors).toEqual([])
    })
  })
}

test('removes the retired sections and their runtime modules', async ({ page }) => {
  const themeRoot = resolve('docs/.vitepress/theme')
  expect(existsSync(resolve(themeRoot, 'website-demo-story.ts'))).toBe(false)
  expect(existsSync(resolve(themeRoot, 'focus-polish.css'))).toBe(false)
  expect(existsSync(resolve(themeRoot, 'project-footer.ts'))).toBe(false)
  expect(existsSync(resolve(themeRoot, 'project-footer.css'))).toBe(false)

  const experienceSource = readFileSync(resolve(themeRoot, 'ExperiencePage.vue'), 'utf8')
  const demoSource = readFileSync(resolve(themeRoot, 'website-demo.ts'), 'utf8')
  const demoStyles = readFileSync(resolve(themeRoot, 'demo-interactions.css'), 'utf8')
  const sharedStyles = readFileSync(resolve(themeRoot, 'custom.css'), 'utf8')
  const motionStyles = readFileSync(resolve(themeRoot, 'motion.css'), 'utf8')
  expect(experienceSource).not.toContain('import-edit')
  expect(experienceSource).not.toContain('desktop-behavior')
  expect(experienceSource).not.toContain('experience-privacy')
  expect(experienceSource).not.toContain('experience-closing')
  expect(experienceSource).not.toContain('course-stage__chrome')
  expect(experienceSource).not.toContain('course-stage__signal')
  expect(experienceSource).not.toContain('course-stage__battery')
  expect(experienceSource).not.toContain('course-stage__dock')
  expect(experienceSource).not.toContain('course-stage__light--two')
  expect(demoSource).not.toContain('setupTrayDemo')
  expect(demoSource).not.toContain('website-demo-story')
  expect(demoStyles).not.toContain('focus-desktop')
  expect(sharedStyles).not.toContain('.course-focus')
  expect(sharedStyles).not.toContain('.focus-desktop')
  expect(sharedStyles).not.toContain('.course-privacy')
  expect(sharedStyles).not.toContain('.course-closing')
  expect(sharedStyles).not.toContain('.course-stage__chrome')
  expect(sharedStyles).not.toContain('.course-stage__signal')
  expect(sharedStyles).not.toContain('.course-stage__battery')
  expect(sharedStyles).not.toContain('.course-stage__dock')
  expect(sharedStyles).not.toContain('.course-stage__light--two')
  expect(motionStyles).not.toContain('course-stage__dock')
  expect(motionStyles).not.toContain('course-stage__light--two')
  expect(motionStyles).not.toContain('course-dock-breathe')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(experiencePath, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4_300)
  await expect(page.locator('.focus-desktop, .focus-desktop__tray-app, .focus-desktop__demo-hint')).toHaveCount(0)
})
