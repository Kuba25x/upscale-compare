import { test, expect } from '@playwright/test';

test('Android has no PWA manifest, icons, registration or cache', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"], link[rel="apple-touch-icon"]')).toHaveCount(0);
  expect(
    await page.evaluate(async () => ({
      registrations:
        'serviceWorker' in navigator
          ? (await navigator.serviceWorker.getRegistrations()).length
          : 0,
      caches: 'caches' in window ? await caches.keys() : [],
    })),
  ).toEqual({ registrations: 0, caches: [] });
});
