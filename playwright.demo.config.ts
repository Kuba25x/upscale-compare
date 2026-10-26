import { defineConfig } from '@playwright/test';
const basePath = process.env.VITE_BASE_PATH || '/upscale-compare/';
const origin = 'http://127.0.0.1:4174';
const launchOptions = {
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
};
export default defineConfig({
  testDir: './tests/demo',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 6000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/demo', open: 'never' }]],
  outputDir: 'test-results/demo',
  use: {
    baseURL: `${origin}${basePath}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'demo-desktop', use: { viewport: { width: 1440, height: 900 }, launchOptions } },
    {
      name: 'demo-mobile',
      grep: /uploads|shared links|pixel/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions,
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --mode demo --port 4174 --strictPort',
    url: `${origin}${basePath}`,
    reuseExistingServer: false,
    env: { VITE_BASE_PATH: basePath },
  },
});
