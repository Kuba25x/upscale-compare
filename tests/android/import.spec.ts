import { test, expect, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { installAndroidBridge } from './bridge';
const files = [0, 1, 2, 3].map((i) => imageFile(`Original ${i}.png`, i % 2));
async function open(page: Page) {
  await page.route('**/original-*.png', (route) => {
    const i = Number(new URL(route.request().url()).pathname.match(/original-(\d+)/)![1]);
    return route.fulfill({ contentType: 'image/png', body: files[i].buffer });
  });
  await installAndroidBridge(
    page,
    files.map((f) => ({
      name: f.name,
      type: f.mimeType,
      width: 640,
      height: 480,
      size: f.buffer.length,
    })),
  );
  await page.goto('/');
}
async function choose(page: Page, indices: number[]) {
  await page.evaluate((indices) => {
    (window as any).pickIndices = indices;
  }, indices);
}
async function config(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('test-session') || 'null'));
}
async function lastRequest(page: Page) {
  return page.evaluate(() => (window as any).pickerCalls.at(-1));
}
test('Photo Picker defaults, min/max validation, single replacement and remaining slots', async ({
  page,
}) => {
  await open(page);
  await choose(page, [0]);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('2–4 images');
  await expect(page.getByTestId('stage')).toHaveCount(0);
  expect(await lastRequest(page)).toEqual({ source: 'photos', minimum: 2, limit: 4 });
  await choose(page, [0, 1]);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect.poll(async () => (await config(page))?.images.length).toBe(2);
  const previous = await config(page);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await choose(page, [0]);
  await page.getByRole('button', { name: 'Replace all images' }).click();
  await expect(page.getByRole('alert')).toContainText('2–4 images');
  await expect.poll(() => config(page)).toEqual(previous);
  await choose(page, [2]);
  await page.getByRole('button', { name: 'Replace', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await lastRequest(page)).toEqual({ source: 'photos', minimum: 1, limit: 1 });
  await expect.poll(async () => (await config(page)).images[0].name).toBe('Original 2.png');
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await choose(page, [0]);
  await page.getByRole('button', { name: 'Add images' }).click();
  expect(await lastRequest(page)).toEqual({ source: 'photos', minimum: 1, limit: 2 });
  await expect.poll(async () => (await config(page)).images.length).toBe(3);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await choose(page, [3]);
  await page.getByRole('button', { name: 'Add images' }).click();
  expect(await lastRequest(page)).toEqual({ source: 'photos', minimum: 1, limit: 1 });
  await expect.poll(async () => (await config(page)).images.length).toBe(4);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add images' })).toHaveCount(0);
});
test('Files is available before import and for replacements; cancel/failure preserve the session', async ({
  page,
}) => {
  await open(page);
  await choose(page, [0, 1]);
  await page.getByRole('button', { name: 'Browse files instead' }).click();
  await expect(page.getByTestId('stage')).toBeVisible();
  expect(await lastRequest(page)).toEqual({ source: 'files', minimum: 2, limit: 4 });
  await expect.poll(async () => (await config(page))?.images.length).toBe(2);
  const previous = await config(page);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await page.getByLabel('Image source').selectOption('files');
  await page.evaluate(() => {
    (window as any).cancelPick = true;
  });
  await page.getByRole('button', { name: 'Replace', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Replace all images' })).toBeEnabled();
  expect(await lastRequest(page)).toEqual({ source: 'files', minimum: 1, limit: 1 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => config(page)).toEqual(previous);
  await page.evaluate(() => {
    (window as any).cancelPick = false;
    (window as any).pickerFailure = 'Cloud image is not available offline.';
  });
  await page.getByRole('button', { name: 'Replace all images' }).click();
  await expect(page.getByRole('alert')).toContainText('not available offline');
  await expect.poll(() => config(page)).toEqual(previous);
});
test('restored picker results retain the saved comparison and ask for a fresh selection', async ({
  page,
}) => {
  await open(page);
  await choose(page, [0, 1]);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await expect.poll(async () => (await config(page))?.images.length).toBe(2);
  const previous = await config(page);
  await page.evaluate(() =>
    (window as any)['listener-appRestoredResult']({
      pluginId: 'Originals',
      methodName: 'pick',
      success: true,
      data: { images: [], interrupted: true },
    }),
  );
  await expect(page.getByRole('alert')).toContainText('Import was interrupted');
  await expect.poll(() => config(page)).toEqual(previous);
  await expect(page.getByTestId('stage')).toBeVisible();
});
