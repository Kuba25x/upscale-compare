import { defineConfig } from '@playwright/test';
const launchOptions = {
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
};
export default defineConfig({
  testDir: './tests/diagnostics',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 6000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/diagnostics', open: 'never' }]],
  outputDir: 'test-results/diagnostics',
  use: {
    baseURL: 'http://127.0.0.1:5175/upscale-compare/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'diagnostics-chromium',
      grepInvert: /native touch recording/,
      use: { viewport: { width: 1440, height: 900 }, launchOptions },
    },
    {
      name: 'diagnostics-mobile',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions,
      },
    },
    ...(process.env.RUN_FIREFOX === 'true'
      ? [
          {
            name: 'diagnostics-firefox',
            grepInvert: /native touch recording/,
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
  ],
  webServer: {
    command: 'npm run dev:demo -- --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175/upscale-compare/',
    reuseExistingServer: false,
  },
});
