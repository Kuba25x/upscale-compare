import { defineConfig } from '@playwright/test';
import pwa from './playwright.pwa.config';

export default defineConfig({
  ...pwa,
  testMatch: /installed-window\.spec\.ts/,
  testIgnore: [],
  outputDir: 'test-results/pwa-install',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/pwa-install', open: 'never' }]],
  projects: [
    {
      name: 'installed-chromium-linux',
      use: { baseURL: 'http://127.0.0.1:4188/upscale-compare/' },
    },
  ],
});
