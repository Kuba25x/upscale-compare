import {
  test,
  expect,
  openLocalComparison,
  openShare,
  publishButton,
  solve,
} from '../production-sharing/fixtures';
import { cacheSnapshot, control, originalBytes } from '../pwa/helpers';
import { imageFile } from '../e2e/fixtures';

test('production sharing and original restoration work with an active worker without caching private responses', async ({
  page,
  context,
  sharing,
}) => {
  await openLocalComparison(page);
  await control(page);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const before = await cacheSnapshot(page);
  await openLocalComparison(page);
  await openShare(page);
  await solve(page);
  await page.getByRole('checkbox').check();
  await publishButton(page).click();
  const link = page.getByLabel('Public comparison link');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(sharing.verification.requests).toHaveLength(1);
  expect(await cacheSnapshot(page)).toEqual(before);
  const publicPage = await context.newPage();
  await publicPage.goto(url);
  await expect(publicPage.getByTestId('stage')).toBeVisible();
  await expect(publicPage.getByTestId('image-A')).toHaveJSProperty('naturalWidth', 640);
  expect(await originalBytes(publicPage)).toEqual(Array.from(imageFile().buffer));
  expect(await cacheSnapshot(publicPage)).toEqual(before);
  const privateURLs = await publicPage.evaluate(async () => {
    const keys: string[] = [];
    for (const name of await caches.keys())
      keys.push(...(await (await caches.open(name)).keys()).map((r) => r.url));
    return keys.filter((url) => /\/api\/|\/s\/|blob:|turnstile|token=/.test(url));
  });
  expect(privateURLs).toEqual([]);
});

test('an active worker preserves verification errors and requires renewed consent', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await control(page);
  const before = await cacheSnapshot(page);
  await openLocalComparison(page);
  await openShare(page);
  await solve(page, 'invalid-');
  await page.getByRole('checkbox').check();
  await publishButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Verification failed or expired');
  await expect(publishButton(page)).toBeDisabled();
  await sharing.empty();
  expect(await cacheSnapshot(page)).toEqual(before);
});
