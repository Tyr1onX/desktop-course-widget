import { expect, test } from '@playwright/test'

const phones = [
  { name: 'phone-large', width: 430, height: 932 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-small', width: 360, height: 800 },
]

for (const phone of phones) {
  test.describe(`mobile composition ${phone.name}`, () => {
    test.use({
      viewport: { width: phone.width, height: phone.height },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    })

    test('uses a readable vertical product layout without overlap', async ({ page }) => {
      await page.goto('/desktop-course-widget/', { waitUntil: 'networkidle' })

      const metrics = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (!element) return null
          const bounds = element.getBoundingClientRect()
          return {
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            left: bounds.left,
            width: bounds.width,
            height: bounds.height,
            position: getComputedStyle(element).position,
            transform: getComputedStyle(element).transform,
          }
        }

        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          copy: rect('.orbit-hero__copy'),
          mark: rect('.orbit-mark'),
          widget: rect('.orbit-float--widget'),
          settings: rect('.orbit-float--settings'),
          calendar: rect('.orbit-settings__calendar'),
          editor: rect('.orbit-settings__editor'),
        }
      })

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      expect(metrics.copy).not.toBeNull()
      expect(metrics.mark).not.toBeNull()
      expect(metrics.widget).not.toBeNull()
      expect(metrics.settings).not.toBeNull()
      expect(metrics.calendar).not.toBeNull()
      expect(metrics.editor).not.toBeNull()

      if (!metrics.copy || !metrics.mark || !metrics.widget || !metrics.settings || !metrics.calendar || !metrics.editor) {
        return
      }

      expect(metrics.copy.bottom).toBeLessThanOrEqual(metrics.mark.top + 1)
      expect(metrics.mark.bottom).toBeLessThanOrEqual(metrics.widget.top + 1)
      expect(metrics.widget.bottom).toBeLessThanOrEqual(metrics.settings.top + 1)
      expect(metrics.calendar.bottom).toBeLessThanOrEqual(metrics.editor.top + 1)

      expect(metrics.widget.position).toBe('static')
      expect(metrics.settings.position).toBe('static')
      expect(metrics.widget.transform).toBe('none')
      expect(metrics.settings.transform).toBe('none')

      expect(metrics.widget.width).toBeGreaterThanOrEqual(280)
      expect(metrics.settings.width).toBeGreaterThanOrEqual(metrics.viewportWidth - 32)
      expect(metrics.calendar.width).toBeGreaterThanOrEqual(metrics.settings.width - 3)
      expect(metrics.editor.width).toBeGreaterThanOrEqual(metrics.settings.width - 3)

      expect(metrics.widget.top).toBeLessThan(metrics.viewportHeight)
      expect(metrics.settings.top).toBeLessThan(metrics.viewportHeight + 120)

      for (const item of [metrics.mark, metrics.widget, metrics.settings, metrics.calendar, metrics.editor]) {
        expect(item.left).toBeGreaterThanOrEqual(-1)
        expect(item.right).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      }
    })
  })
}
