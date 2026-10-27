import { defineConfig } from '@playwright/test';
const testState = `.wrangler/e2e-${process.pid}`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 6000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile/,
      use: {
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
          args: ['--no-sandbox'],
        },
      },
    },
    {
      name: 'hidpi',
      testMatch: /viewer/,
      grep: /pixel/,
      use: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
          args: ['--no-sandbox'],
        },
      },
    },
    {
      name: 'fractional-dpi',
      testMatch: /viewer/,
      grep: /pixel/,
      use: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1.25,
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
          args: ['--no-sandbox'],
        },
      },
    },
    ...(process.env.RUN_FIREFOX === 'true'
      ? [
          {
            name: 'firefox-viewer',
            testMatch: /(panning|divider-focus|pinch)\.spec\.ts/,
            use: {
              browserName: 'firefox' as const,
              viewport: { width: 1440, height: 900 },
              launchOptions: process.env.FIREFOX_PATH
                ? { executablePath: process.env.FIREFOX_PATH }
                : {},
            },
          },
        ]
      : []),
    {
      name: 'mobile',
      testMatch: /mobile/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
          args: ['--no-sandbox'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run db:local -- --persist-to ${testState} && npm run dev:api -- --persist-to ${testState}`,
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
  ],
});
