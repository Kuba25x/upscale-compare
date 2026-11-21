import { test, expect } from '@playwright/test';
import { openComparisonHelp } from '../shared/phone-controls';
import { imageFile } from '../e2e/fixtures';

test('uploads local images when offline worker registration fails', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, '__workerRegistrationCalls', { value: calls });
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register = async (url) => {
        calls.push(String(url));
        throw new Error('Simulated registration failure');
      };
  });
  await page.goto('./');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  const manifestURL = await manifestLink.evaluate((link: HTMLLinkElement) => link.href);
  expect(manifestURL).toBe(new URL('manifest.webmanifest', baseURL).href);
  const response = await page.request.get(manifestURL);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.scope).toBe(new URL(baseURL!).pathname);
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, manifestURL).href);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('image/png');
  }
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await page.request.get(new URL(apple!, baseURL).href)).ok()).toBeTruthy();
  expect((await page.request.get(new URL('sw.js', baseURL).href)).ok()).toBeTruthy();
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  await openComparisonHelp(page);
  await expect(page.getByRole('link', { name: /source/i })).toHaveAttribute(
    'href',
    'https://github.com/Kuba25x/upscale-compare',
  );
  const licenses = await page.getByRole('link', { name: /third.party/i }).getAttribute('href');
  expect(await (await page.request.get(new URL(licenses!, baseURL).href)).text()).toContain(
    'workbox-core',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __workerRegistrationCalls: string[] })
            .__workerRegistrationCalls.length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(async () => ({
      calls: (window as typeof window & { __workerRegistrationCalls: string[] })
        .__workerRegistrationCalls,
      registrations:
        'serviceWorker' in navigator
          ? (await navigator.serviceWorker.getRegistrations()).length
          : 0,
      caches: 'caches' in window ? await caches.keys() : [],
    })),
  ).toEqual({ calls: [new URL('sw.js', baseURL).href], registrations: 0, caches: [] });
});
