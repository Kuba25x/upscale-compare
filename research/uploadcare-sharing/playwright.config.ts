import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { APP_URL } from './settings';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  outputDir: '../../test-results/uploadcare-sharing',
  use: {
    baseURL: APP_URL,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node research/uploadcare-sharing/serve.mjs',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: APP_URL,
    reuseExistingServer: false,
  },
});
