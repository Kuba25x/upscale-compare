import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { imageFile } from '../e2e/fixtures';

const unexpectedRequests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  const allowed = new URL(baseURL!);
  const requests: string[] = [];
  unexpectedRequests.set(page, requests);
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (
      url.origin !== allowed.origin ||
      !url.pathname.startsWith(allowed.pathname) ||
      /\/(api|s)\//.test(url.pathname)
    ) {
      requests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => {
  expect(
    unexpectedRequests.get(page),
    'Demo must never request a backend or third-party verification',
  ).toEqual([]);
  await expect(page.locator('script[src*="turnstile"], iframe[src*="turnstile"]')).toHaveCount(0);
});
async function openDemo(page: Page) {
  await page.goto('./');
  await page
    .getByTestId('file-input')
    .setInputFiles([imageFile(), imageFile('FSR Quality.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
}

test('uploads screenshots locally and clearly explains unavailable sharing', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#demo-sharing-note')).toContainText(
    'Public sharing is not available yet',
  );
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(heading!.x + heading!.width / 2).toBeCloseTo(page.viewportSize()!.width / 2, 0);
  await page
    .getByTestId('file-input')
    .setInputFiles([imageFile(), imageFile('FSR Quality.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  const share = page.getByRole('button', { name: 'Share Comparison', exact: true });
  await expect(share).toBeDisabled();
  await expect(share).toHaveAccessibleDescription(/Public sharing is not available yet/);
  await expect(page.locator('#demo-sharing-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
});

test('keeps labels, metadata, four-image selection, addition, and replacement', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByLabel('Label for image A').fill('Custom DLSS');
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await page.getByLabel('Game title').fill('Demo game');
  await page.getByLabel('GPU / hardware').fill('Test GPU');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  const add = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add images', exact: true }).click();
  await (await add).setFiles([imageFile('Native.png'), imageFile('XeSS.png', 1)]);
  await expect(page.getByLabel('Select image A').locator('option')).toHaveCount(4);
  await page.getByLabel('Select image A').selectOption('2');
  await page.getByLabel('Label for image A').fill('Native Ultra');
  await expect(page.locator('.badge-a')).toContainText('Native Ultra');
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  const replacement = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace', exact: true }).nth(2).click();
  await (await replacement).setFiles(imageFile('Small.png', 0, 320, 240));
  await expect(page.locator('.alignment-warning')).toContainText('Different dimensions');
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await expect(page.getByLabel('Game title')).toHaveValue('Demo game');
  await expect(page.getByLabel('GPU / hardware')).toHaveValue('Test GPU');
});

test('keeps the split divider and synchronized zoom and panning across modes', async ({ page }) => {
  await openDemo(page);
  const stage = await page.getByTestId('stage').boundingBox();
  await page.mouse.move(stage!.x + stage!.width / 2, stage!.y + stage!.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage!.x + stage!.width * 0.65, stage!.y + stage!.height / 2);
  await page.mouse.up();
  expect(Number(await page.getByRole('slider').getAttribute('aria-valuenow'))).toBeCloseTo(65, 0);
  await page.getByRole('button', { name: '200%', exact: true }).click();
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
  const beforeA = await page.getByTestId('image-A').boundingBox(),
    beforeB = await page.getByTestId('image-B').boundingBox();
  await page.mouse.move(stage!.x + 140, stage!.y + 160);
  await page.mouse.down();
  await page.mouse.move(stage!.x + 180, stage!.y + 185);
  await page.mouse.up();
  const afterA = await page.getByTestId('image-A').boundingBox(),
    afterB = await page.getByTestId('image-B').boundingBox();
  expect(afterA!.x - beforeA!.x).toBeCloseTo(40, 4);
  expect(afterB!.x - beforeB!.x).toBeCloseTo(40, 4);
  expect(afterA!.y - beforeA!.y).toBeCloseTo(25, 4);
  expect(afterB!.y - beforeB!.y).toBeCloseTo(25, 4);
  await page.getByRole('button', { name: 'Split Screen', exact: true }).click();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
});

test('preserves pixel-accurate zoom in the production demo', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const ratio = await page.evaluate(() => devicePixelRatio);
  const bounds = await page.getByTestId('image-A').boundingBox();
  expect(bounds!.width * ratio).toBeCloseTo(640, 4);
  expect(bounds!.height * ratio).toBeCloseTo(480, 4);
  const shot = PNG.sync.read(await page.screenshot());
  const x = 70,
    y = 132;
  const index =
    ((Math.round(bounds!.y * ratio) + y) * shot.width + Math.round(bounds!.x * ratio) + x) * 4;
  expect([...shot.data.subarray(index, index + 4)]).toEqual([x, y, 80, 255]);
});

test('refuses shared links and refresh without making API requests', async ({ page }) => {
  await page.goto('./#c/aaaaaaaaaaaaaaaa');
  await expect(page.getByRole('alert')).toContainText(
    'Public sharing is not available in this demo',
  );
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'Public sharing is not available in this demo',
  );
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#c/bbbbbbbbbbbbbbbb';
  });
  await expect(page.getByRole('alert')).toContainText(
    'Public sharing is not available in this demo',
  );
  await expect(page.getByTestId('stage')).toBeVisible();
});

test('keeps privacy information, keyboard shortcuts, and fullscreen available', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Frontend-only demo');
  await expect(page.getByRole('dialog')).toContainText(
    'No sharing service or verification widget is contacted',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('body').click({ position: { x: 2, y: 200 } });
  await page.keyboard.press('4');
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '4');
  await page.keyboard.press('v');
  await expect(page.getByRole('button', { name: 'Side-by-Side', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
});

test('serves built assets and license notices at the GitHub Pages subpath', async ({
  page,
  baseURL,
}) => {
  await page.goto('./');
  const script = await page.locator('script[type="module"]').getAttribute('src');
  expect(script).toMatch(new RegExp(`^${new URL(baseURL!).pathname}assets/`));
  for (const file of ['favicon.svg', 'third-party-licenses.txt']) {
    const response = await page.request.get(new URL(file, baseURL!).href);
    expect(response.status()).toBe(200);
  }
  await page.screenshot({ path: 'test-results/demo/landing.png' });
});
