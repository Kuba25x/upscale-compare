import { test, expect } from '@playwright/test';
import { openComparisonHelp } from '../shared/phone-controls';
import { imageFile } from '../e2e/fixtures';
import { serve } from './helpers';

async function help(page: import('@playwright/test').Page) {
  const dialog = await openComparisonHelp(page);
  await expect(
    page.getByRole('heading', { name: 'Installation and offline', exact: true }),
  ).toBeVisible();
  return dialog;
}

test('Help reports offline readiness only after the full cache and detects missing resources', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await serve(request, 'a', 'hold');
  await page.goto(baseURL!);
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.installing?.state,
      ),
    )
    .toBe('installing');
  const dialog = await help(page);
  await expect(page.getByTestId('offline-readiness')).toContainText('not ready');
  await expect(dialog).toContainText('Version 0.1.0+aaaaaaa1');
  await expect(page.getByRole('button', { name: /install/i })).toHaveCount(0);
  await serve(request);
  await expect(page.getByTestId('offline-readiness')).toHaveText(
    'App resources are ready offline.',
  );
  await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await help(page);
  await expect(page.getByTestId('offline-readiness')).toHaveText(
    'App resources are ready offline.',
  );
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.evaluate(async () => {
    for (const name of await caches.keys())
      if (name.startsWith('upscale-compare-precache-')) {
        const cache = await caches.open(name);
        for (const request of await cache.keys())
          if (new URL(request.url).pathname.endsWith('/icons/apple-touch-icon.png'))
            await cache.delete(request);
      }
  });
  await help(page);
  await expect(page.getByTestId('offline-readiness')).toContainText('not ready');
  await expect(dialog).toContainText('empty comparison');
});
