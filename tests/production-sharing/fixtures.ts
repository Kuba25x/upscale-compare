import { readFile } from 'node:fs/promises';
import { test as base, expect, type Page } from '@playwright/test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { configureTestCostControls, migrateTestDatabase } from '../fixtures/database';
import { LOCAL_VERIFICATION_SECRET, VerificationService } from '../fixtures/verification';
import { imageFile } from '../e2e/fixtures';
import settings from './settings.json' with { type: 'json' };

export const WIDGET_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
type Harness = {
  mf: Miniflare;
  verification: VerificationService;
  scriptRequests: number;
  scriptFailures: number;
  scriptGate?: Promise<void>;
  setUploads: (enabled: boolean, secret?: string) => Promise<void>;
  setAllowedOrigin: (origin: string) => Promise<void>;
  empty: () => Promise<void>;
};
export const test = base.extend<{ sharing: Harness }>({
  sharing: [
    async ({ context, baseURL }, use) => {
      const frontend = new URL(baseURL!),
        api = new URL(settings.apiOrigin);
      if (frontend.hostname !== '127.0.0.1' || api.hostname !== '127.0.0.1')
        throw new Error('Local sharing fixture requires loopback origins.');
      const verification = new VerificationService(frontend.hostname);
      let allowedOrigin = frontend.origin;
      const options = (enabled: boolean, secret?: string) =>
        convertV4MiniflareOptions({
          host: api.hostname,
          port: Number(api.port),
          modules: true,
          scriptPath: 'worker/dist/index.js',
          compatibilityDate: '2026-07-01',
          d1Databases: ['DB'],
          r2Buckets: ['IMAGES'],
          bindings: {
            ENVIRONMENT: 'production',
            UPLOADS_ENABLED: String(enabled),
            ALLOWED_ORIGINS: allowedOrigin,
            FRONTEND_URL: baseURL!,
            PUBLISHES_PER_HOUR: '100',
            ...(secret ? { TURNSTILE_SECRET: secret } : {}),
          },
          outboundService: verification.fetch,
        });
      const mf = new Miniflare(options(true, LOCAL_VERIFICATION_SECRET));
      const unexpected: string[] = [];
      const harness: Harness = {
        mf,
        verification,
        scriptRequests: 0,
        scriptFailures: 0,
        async setUploads(enabled, secret = LOCAL_VERIFICATION_SECRET) {
          await mf.setOptions(options(enabled, secret));
          expect((await mf.ready).origin).toBe(settings.apiOrigin);
        },
        async setAllowedOrigin(origin) {
          allowedOrigin = origin;
          await mf.setOptions(options(true, LOCAL_VERIFICATION_SECRET));
          expect((await mf.ready).origin).toBe(settings.apiOrigin);
        },
        async empty() {
          const db = await mf.getD1Database('DB');
          expect(await db.prepare('SELECT used_bytes, comparisons FROM quota').first()).toEqual({
            used_bytes: 0,
            comparisons: 0,
          });
          expect((await db.prepare('SELECT * FROM comparisons').all()).results).toHaveLength(0);
          expect((await (await mf.getR2Bucket('IMAGES')).list()).objects).toHaveLength(0);
        },
      };
      try {
        expect((await mf.ready).origin).toBe(settings.apiOrigin);
        await migrateTestDatabase(await mf.getD1Database('DB'));
        await configureTestCostControls(await mf.getD1Database('DB'));
        const widget = await readFile('tests/production-sharing/widget.js', 'utf8');
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (
            url.origin === frontend.origin ||
            url.origin === api.origin ||
            ['blob:', 'data:'].includes(url.protocol)
          )
            return route.continue();
          if (url.href === WIDGET_URL) {
            harness.scriptRequests++;
            if (harness.scriptFailures > 0) {
              harness.scriptFailures--;
              return route.abort();
            }
            if (harness.scriptGate) await harness.scriptGate;
            return route.fulfill({ status: 200, contentType: 'text/javascript', body: widget });
          }
          unexpected.push(url.origin + url.pathname);
          await route.abort();
        });
        await use(harness);
        expect(unexpected).toEqual([]);
      } finally {
        await context.unrouteAll({ behavior: 'ignoreErrors' });
        await mf.dispose();
      }
    },
    { auto: true },
  ],
});
export { expect, settings };
export async function openLocalComparison(page: Page) {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('Native.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
}
export const openShare = (page: Page) =>
  page.getByRole('button', { name: 'Share Comparison', exact: true }).click();
export const publishButton = (page: Page) =>
  page.getByRole('button', { name: 'Publish comparison', exact: true });
export async function solve(page: Page, prefix = 'valid-') {
  await expect(
    page.getByRole('button', { name: 'Complete local verification', exact: true }),
  ).toBeVisible();
  await page.evaluate((prefix) => {
    (window as unknown as { __localVerification: { prefix: string } }).__localVerification.prefix =
      prefix;
  }, prefix);
  await page.getByRole('button', { name: 'Complete local verification', exact: true }).click();
}
