import { test, expect } from '@playwright/test';

test('Android has no PWA manifest, icons, registration or cache', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__registrationCalls', { value: [] });
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register = async (url) => {
        (window as typeof window & { __registrationCalls: string[] }).__registrationCalls.push(
          String(url),
        );
        throw new Error('Android must never register a worker');
      };
  });
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"], link[rel="apple-touch-icon"]')).toHaveCount(0);
  expect(
    await page.evaluate(async () => ({
      calls: (window as typeof window & { __registrationCalls: string[] }).__registrationCalls,
      registrations:
        'serviceWorker' in navigator
          ? (await navigator.serviceWorker.getRegistrations()).length
          : 0,
      caches: 'caches' in window ? await caches.keys() : [],
    })),
  ).toEqual({ calls: [], registrations: 0, caches: [] });
});
