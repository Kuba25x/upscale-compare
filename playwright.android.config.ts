import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/android',
  outputDir: 'test-results/android',
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: 'http://127.0.0.1:4176',
    viewport: { width: 412, height: 900 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command: 'npx vite preview --mode android --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false,
  },
});
