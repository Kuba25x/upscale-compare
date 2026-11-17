import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:4188';
const chromium = {
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  },
};
export default defineConfig({
  testDir: './tests/pwa',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: 'test-results/pwa',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/pwa', open: 'never' }]],
  use: { serviceWorkers: 'allow', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    ...['/', '/upscale-compare/'].map((base) => ({
      name: `pwa-chromium-${base === '/' ? 'root' : 'pages'}`,
      use: { ...chromium, baseURL: `${origin}${base}`, viewport: { width: 1440, height: 900 } },
    })),
    {
      name: 'pwa-chromium-mobile',
      use: {
        ...chromium,
        baseURL: `${origin}/upscale-compare/`,
        viewport: { width: 412, height: 900 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
    ...(['firefox', 'webkit'] as const).flatMap((browserName) =>
      process.env[`RUN_${browserName.toUpperCase()}`] === 'true'
        ? [
            {
              name: `pwa-${browserName}`,
              use: {
                browserName,
                baseURL: `${origin}/upscale-compare/`,
                viewport: { width: 412, height: 900 },
                hasTouch: true,
                deviceScaleFactor: 2,
              },
            },
          ]
        : [],
    ),
  ],
  webServer: {
    command: 'node scripts/serve-pwa-tests.mjs',
    url: origin,
    reuseExistingServer: false,
  },
});
