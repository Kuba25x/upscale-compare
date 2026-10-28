import { defineConfig } from '@playwright/test';
import settings from './tests/production-sharing/settings.json' with { type: 'json' };

const launchOptions = {
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
};
export default defineConfig({
  testDir: './tests/production-sharing',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 6000 },
  outputDir: 'test-results/sharing',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/sharing', open: 'never' }]],
  use: {
    baseURL: settings.frontendOrigin + settings.basePath,
    launchOptions,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'sharing-desktop',
      testIgnore: /missing-key/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'sharing-mobile',
      testIgnore: /missing-key/,
      grep: /publishes after consent|expired verification|lost success response/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'sharing-missing-key',
      testMatch: /missing-key/,
      use: { baseURL: settings.missingKeyOrigin + settings.basePath },
    },
  ],
  webServer: [
    {
      command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4176 --strictPort --outDir ${settings.outputRoot}/with-key`,
      url: settings.frontendOrigin + settings.basePath,
      reuseExistingServer: false,
      env: { VITE_BASE_PATH: settings.basePath },
    },
    {
      command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4177 --strictPort --outDir ${settings.outputRoot}/missing-key`,
      url: settings.missingKeyOrigin + settings.basePath,
      reuseExistingServer: false,
      env: { VITE_BASE_PATH: settings.basePath },
    },
  ],
});
