import { defineConfig } from '@playwright/test';
import sharing from './playwright.sharing.config';

export default defineConfig({
  ...sharing,
  testDir: './tests/pwa-sharing',
  outputDir: 'test-results/pwa-sharing',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/pwa-sharing', open: 'never' }]],
  use: { ...sharing.use, serviceWorkers: 'allow' },
  projects: [{ name: 'active-worker-sharing', use: { viewport: { width: 1440, height: 900 } } }],
});
