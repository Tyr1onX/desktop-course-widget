import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run docs:preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/desktop-course-widget/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
