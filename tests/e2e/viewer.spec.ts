import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { imageFile, openComparison } from './fixtures';
test('landing follows the centered wireframe and keeps screenshots local', async ({ page }) => {
  const publications: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') publications.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeVisible();
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(Math.abs(heading!.x + heading!.width / 2 - 720)).toBeLessThan(1);
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  expect(publications).toEqual([]);
  const title = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(Math.abs(title!.x + title!.width / 2 - 720)).toBeLessThan(1);
  const share = await page.getByRole('button', { name: 'Share Comparison' }).boundingBox();
  const upload = await page.getByRole('button', { name: 'Upload Images' }).boundingBox();
  expect(upload!.x - (share!.x + share!.width)).toBeLessThan(12);
  await page.screenshot({ path: 'test-results/viewer-desktop.png' });
});
test('requires two valid images and handles decode errors', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([imageFile()]);
  await expect(page.getByRole('alert')).toContainText('two to four');
  await page
    .getByTestId('file-input')
    .setInputFiles([
      imageFile(),
      { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('<svg>') },
    ]);
  await expect(page.getByRole('alert')).toContainText('could not be decoded');
  await expect(page.getByTestId('stage')).toHaveCount(0);
});
test('drag-and-drop opens a comparison without publishing', async ({ page }) => {
  await page.goto('/');
  const files = [imageFile(), imageFile('FSR.png', 1)].map((file) => ({
    name: file.name,
    bytes: [...file.buffer],
  }));
  await page.locator('.landing').evaluate((element, values) => {
    const transfer = new DataTransfer();
    values.forEach((value) =>
      transfer.items.add(
        new File([new Uint8Array(value.bytes)], value.name, { type: 'image/png' }),
      ),
    );
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }, files);
  await expect(page.getByTestId('stage')).toBeVisible();
});
test('divider drags, supports keyboard, and keeps corresponding coordinates', async ({ page }) => {
  await openComparison(page);
  const stage = await page.getByTestId('stage').boundingBox(),
    divider = page.getByRole('slider', { name: 'Comparison divider' });
  await page.mouse.move(stage!.x + stage!.width / 2, stage!.y + stage!.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage!.x + stage!.width * 0.7, stage!.y + stage!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', '70');
  const a = await page.getByTestId('image-A').boundingBox(),
    b = await page.getByTestId('image-B').boundingBox();
  expect(a).toEqual(b);
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '100');
});
test('100% pixel zoom reproduces original pixels at every display density', async ({ page }) => {
  await openComparison(page);
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const ratio = await page.evaluate(() => devicePixelRatio);
  const img = await page.getByTestId('image-A').boundingBox();
  expect(img!.width * ratio).toBeCloseTo(640, 4);
  expect(img!.height * ratio).toBeCloseTo(480, 4);
  const shot = PNG.sync.read(await page.screenshot());
  for (const [x, y] of [
    [35, 110],
    [70, 132],
    [110, 148],
  ]) {
    const screenX = Math.round(img!.x * ratio) + x,
      screenY = Math.round(img!.y * ratio) + y;
    const index = (screenY * shot.width + screenX) * 4;
    expect([...shot.data.subarray(index, index + 4)]).toEqual([x % 256, y % 256, 80, 255]);
  }
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
  const sideShot = PNG.sync.read(await page.screenshot());
  for (const side of ['A', 'B']) {
    const bounds = await page.getByTestId(`image-${side}`).boundingBox();
    const x = 70,
      y = 132;
    const index =
      ((Math.round(bounds!.y * ratio) + y) * sideShot.width + Math.round(bounds!.x * ratio) + x) *
      4;
    expect([...sideShot.data.subarray(index, index + 4)]).toEqual(
      side === 'A' ? [x, y, 80, 255] : [180, y, x, 255],
    );
  }
});
test('zoom at the cursor preserves the inspected source coordinate', async ({ page }) => {
  await openComparison(page);
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const old = await page.getByTestId('image-A').boundingBox(),
    stage = await page.getByTestId('stage').boundingBox();
  const point = {
    x: Math.round(stage!.x + stage!.width * 0.4),
    y: Math.round(stage!.y + stage!.height * 0.4),
  };
  const source = {
    x: (point.x - old!.x) / (old!.width / 640),
    y: (point.y - old!.y) / (old!.width / 640),
  };
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -200);
  await expect
    .poll(async () => (await page.getByTestId('image-A').boundingBox())!.width)
    .toBeGreaterThan(old!.width);
  const next = await page.getByTestId('image-A').boundingBox();
  expect((point.x - next!.x) / (next!.width / 640)).toBeCloseTo(source.x, 1);
  expect((point.y - next!.y) / (next!.width / 640)).toBeCloseTo(source.y, 1);
});
test('side-by-side keeps zoom and synchronizes panning', async ({ page }) => {
  await openComparison(page);
  await page.getByRole('button', { name: '200%', exact: true }).click();
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
  const beforeA = await page.getByTestId('image-A').boundingBox(),
    beforeB = await page.getByTestId('image-B').boundingBox();
  const stage = await page.getByTestId('stage').boundingBox();
  await page.mouse.move(stage!.x + 140, stage!.y + 160);
  await page.mouse.down();
  await page.mouse.move(stage!.x + 180, stage!.y + 185, { steps: 5 });
  await page.mouse.up();
  const afterA = await page.getByTestId('image-A').boundingBox(),
    afterB = await page.getByTestId('image-B').boundingBox();
  expect(afterA!.x - beforeA!.x).toBe(40);
  expect(afterB!.x - beforeB!.x).toBe(40);
  expect(afterA!.y - beforeA!.y).toBe(25);
  expect(afterB!.y - beforeB!.y).toBe(25);
  await page.getByRole('button', { name: 'Split Screen', exact: true }).click();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
});
test('selects any of four images, renames labels, and saves metadata', async ({ page }) => {
  await openComparison(page, 4);
  await page.getByLabel('Select image A').selectOption('2');
  await page.getByLabel('Label for image A').fill('Native · Ultra');
  await expect(page.locator('.badge-a')).toContainText('Native · Ultra');
  await page.getByRole('button', { name: 'Comparison details' }).click();
  await page.getByLabel('Game title').fill('Cyberpunk 2077');
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByRole('button', { name: 'Comparison details' }).click();
  await expect(page.getByLabel('Game title')).toHaveValue('Cyberpunk 2077');
});
test('replaces an image and warns about different dimensions without stretching', async ({
  page,
}) => {
  await openComparison(page);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace', exact: true }).first().click();
  await (await chooser).setFiles(imageFile('Small.png', 1, 320, 240));
  await expect(page.locator('.alignment-warning')).toContainText('Different dimensions');
  const a = await page.getByTestId('image-A').boundingBox(),
    b = await page.getByTestId('image-B').boundingBox();
  expect(b!.width / a!.width).toBeCloseTo(2, 5);
  expect(a!.x).toBe(b!.x);
  expect(a!.y).toBe(b!.y);
});
test('keyboard shortcuts and fullscreen work', async ({ page }) => {
  await openComparison(page);
  await page.locator('body').click({ position: { x: 5, y: 75 } });
  await page.keyboard.press('4');
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '4');
  await page.keyboard.press('v');
  await expect(page.getByRole('button', { name: 'Side-by-Side', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
});
test('publishes only after confirmation and restores the public URL on refresh', async ({
  page,
}) => {
  await openComparison(page);
  await page.getByLabel('Label for image A').fill('Custom DLSS');
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
  await page.getByRole('button', { name: '200%', exact: true }).click();
  await page.getByRole('button', { name: 'Share Comparison' }).click();
  const publish = page.getByRole('button', { name: 'Publish comparison', exact: true });
  await expect(publish).toBeDisabled();
  await page.getByRole('checkbox').check();
  await publish.click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  const url = await page.getByLabel('Public comparison link').inputValue();
  expect(url).toMatch(/\/s\/[a-f0-9]{16}$/);
  await page.goto(url);
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
  await expect(page.getByRole('button', { name: 'Side-by-Side', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.badge-a')).toContainText('Custom DLSS');
  await expect(page.getByLabel('Label for image A')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('stage')).toBeVisible();
});
test('handles unavailable sharing service and invalid public links', async ({ page }) => {
  await openComparison(page);
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Sharing is offline.' }),
    }),
  );
  await page.getByRole('button', { name: 'Share Comparison' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sharing is offline.');
  await expect(
    page.getByRole('button', { name: 'Publish comparison', exact: true }),
  ).toBeDisabled();
  await page.goto('/#c/aaaaaaaaaaaaaaaa');
  await expect(page.getByRole('alert')).toContainText('Comparison not found');
});

test('owner can recover their deletion key and remove a published comparison', async ({ page }) => {
  await openComparison(page);
  await page.getByRole('button', { name: 'Share Comparison' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish comparison', exact: true }).click();
  const link = page.getByLabel('Public comparison link');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  await page.goto(url);
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.getByRole('button', { name: 'Share Comparison' }).click();
  await page.getByText('Manage published comparison', { exact: true }).click();
  await expect(page.getByLabel('Private deletion key')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Delete comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comparison deleted' })).toBeVisible();
  await page.goto('/');
  await page.goto(url);
  await expect(page.getByRole('alert')).toContainText('Comparison not found');
});
