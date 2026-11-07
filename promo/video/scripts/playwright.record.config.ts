import { defineConfig } from '@playwright/test'

const FILM_ROOT =
  process.env.FILM_ROOT ??
  '/home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min'

export default defineConfig({
  testDir: './recording',
  testMatch: 'record-ui.spec.ts',
  outputDir: `${FILM_ROOT}/recordings/.test-results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    testIdAttribute: 'data-testid',
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    launchOptions: {
      executablePath: '/home/sky/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    },
    trace: 'off',
    screenshot: 'off',
  },
})
