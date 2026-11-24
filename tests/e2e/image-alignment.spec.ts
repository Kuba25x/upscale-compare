import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { imageFile } from './fixtures';
import {
  applyAlignment,
  changeAlignment,
  expectAligned,
  geometry,
  mismatch,
  pixelAt,
  solidImage,
  storedComparison,
} from '../shared/image-alignment';
import { expectSplitPosition } from '../shared/layout-alignment';
import { selectImage } from '../shared/phone-controls';

test('applies proportional geometry, physical pixel zoom and actual clipping in both modes', async ({
  page,
}) => {
  const green = [30, 220, 110];
  const blue = [45, 80, 250];
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles([solidImage('A.png', 320, 240, green), solidImage('B.png', 160, 240, blue)]);
  const dialog = mismatch(page);
  await expect(dialog).toContainText('Image A 320 × 240');
  await expect(dialog).toContainText('Image B 160 × 240');
  await expect(dialog.getByRole('radio', { name: 'Original Size' })).toBeChecked();
  await applyAlignment(page, 'Match Width');
  await expectAligned(page, 2);
  const slider = page.getByRole('slider');
  const stage = page.getByTestId('stage');
  const { a, stage: area } = await geometry(page);
  const y = a.y - area.y + a.height / 2;
  const x = area.width / 2;
  const screenshot = async () => PNG.sync.read(await stage.screenshot({ scale: 'css' }));
  let frame = await screenshot();
  expect(pixelAt(frame, x - 40, y)).toEqual(green);
  expect(pixelAt(frame, x + 40, y)).toEqual(blue);
  await slider.press('Home');
  await expectSplitPosition(page, 0);
  expect(pixelAt(await screenshot(), x - 40, y)).toEqual(blue);
  await slider.press('End');
  await expectSplitPosition(page, 100);
  expect(pixelAt(await screenshot(), x + 40, y)).toEqual(green);
  await slider.press('Home');
  for (let step = 0; step < 5; step++) await slider.press('Shift+ArrowRight');
  await changeAlignment(page, 'Match Height');
  await expectSplitPosition(page, 50);
  await expectAligned(page, 1);
  const newBounds = await geometry(page);
  frame = await screenshot();
  expect(pixelAt(frame, x + 40, newBounds.a.y - area.y + newBounds.a.height / 2)).toEqual([
    23, 25, 30,
  ]);

  await changeAlignment(page, 'Match Width');
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
  await expectAligned(page, 2, true);
  for (const zoom of [1, 2, 4]) {
    await page.getByRole('button', { name: `${zoom * 100}%`, exact: true }).click();
    await expectAligned(page, 2, true, zoom);
  }
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.getByLabel('Current zoom')).toHaveText('100% · A');
  await expect(page.getByLabel('Current zoom')).toHaveAccessibleDescription(
    'Image A: 100%. Image B: 200%.',
  );
  const before = await geometry(page);
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  const panned = await geometry(page);
  expect(panned.a.x - before.a.x).toBeCloseTo(-50, 0);
  expect(panned.b.x - before.b.x).toBeCloseTo(-50, 0);
  await changeAlignment(page, 'Original Size');
  await expectAligned(page, 1, true, 1);
  await expect(page.getByLabel('Current zoom')).toHaveText('100% · 1:1');
  expect((await geometry(page)).a).toEqual(panned.a);
});

test('remembers choices and dismissal per pair across selectors, swaps, and reload', async ({
  page,
}) => {
  const files = [
    imageFile('A.png'),
    imageFile('B.png', 1, 320, 240),
    imageFile('C.png'),
    imageFile('D.png', 1, 200, 300),
  ];
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files);
  await mismatch(page).getByRole('radio', { name: 'Match Height' }).check();
  await page.keyboard.press('Escape');
  await expectAligned(page, 1);
  await page.getByRole('button', { name: 'Swap images' }).click();
  await expect(mismatch(page)).toHaveCount(0);
  await expectAligned(page, 1);
  await changeAlignment(page, 'Match Width');
  await expectAligned(page, 0.5);
  await changeAlignment(page, 'Match Height');
  await expectAligned(page, 0.5);
  await page.getByRole('button', { name: 'Swap images' }).click();
  await expectAligned(page, 2);
  await selectImage(page, 'B', 2);
  await expect(mismatch(page)).toHaveCount(0);
  await changeAlignment(page, 'Match Width');
  await expectAligned(page, 1);
  await selectImage(page, 'B', 3);
  await applyAlignment(page, 'Match Height');
  await expectAligned(page, 1.6);
  await selectImage(page, 'B', 1);
  await expect(mismatch(page)).toHaveCount(0);
  await expectAligned(page, 2);
  await expect
    .poll(async () => (await storedComparison(page)).session?.config.selected)
    .toEqual([0, 1]);
  await page.reload();
  await expectAligned(page, 2);
  await expect(mismatch(page)).toHaveCount(0);
  await selectImage(page, 'B', 3);
  await expectAligned(page, 1.6);
  await expect(mismatch(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  const manage = page.getByRole('dialog', { name: 'Your images' });
  await manage.getByRole('button', { name: 'Remove image B.png' }).click();
  await manage.getByRole('button', { name: 'Close dialog' }).click();
  await expectAligned(page, 1.6);
  await expect(mismatch(page)).toHaveCount(0);
  await page.getByTestId('stage').focus();
  await page.keyboard.press(']');
  await applyAlignment(page, 'Match Width');
  await expectAligned(page, 3.2);
});

test('renders visible pixels of very large layers and restores their positions', async ({
  page,
}) => {
  const colors = [
    [224, 40, 50],
    [25, 65, 220],
  ];
  const source = new PNG({ width: 1, height: 16_384 });
  for (let y = 0; y < source.height; y++)
    source.data.set([...colors[Number(y >= 8192)], 255], y * 4);
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles([
      solidImage('Wide.png', 16_384, 1, [20, 180, 40]),
      { name: 'Tall.png', mimeType: 'image/png', buffer: PNG.sync.write(source) },
    ]);
  await applyAlignment(page, 'Match Width');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const stage = page.getByTestId('stage');
  await expect(page.getByTestId('viewport-image-B')).toBeVisible();
  const assertPixels = async () => {
    const screen = PNG.sync.read(await stage.screenshot({ scale: 'css' }));
    expect(pixelAt(screen, screen.width * 0.75, screen.height / 2 - 20)).toEqual(colors[0]);
    expect(pixelAt(screen, screen.width * 0.75, screen.height / 2 + 20)).toEqual(colors[1]);
  };
  await assertPixels();
  await expect.poll(async () => (await storedComparison(page)).session?.config.view.zoom).toBe(1);
  await page.reload();
  await expect(page.getByTestId('viewport-image-B')).toBeVisible();
  await assertPixels();
});

test('handles denied persistent storage and quota errors, and clears originals atomically', async ({
  page,
  context,
}) => {
  const network: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') network.push(request.url());
  });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, 'storageCalls', { value: calls });
    navigator.storage.persisted = async () => {
      calls.push('persisted');
      return false;
    };
    navigator.storage.persist = async () => {
      calls.push('persist');
      return false;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'originals' && sessionStorage.getItem('mock-quota'))
        throw new DOMException('Test quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([imageFile('A.png'), imageFile('B.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'storageCalls'))).toEqual([
    'persisted',
    'persist',
  ]);
  const previous = await storedComparison(page);
  expect(previous.originals).toBe(2);
  const stale = await context.newPage();
  await stale.goto(page.url());
  await expect(stale.getByTestId('stage')).toBeVisible();

  await page.evaluate(() => sessionStorage.setItem('mock-quota', 'true'));
  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  const manage = page.getByRole('dialog', { name: 'Your images' });
  const chooser = page.waitForEvent('filechooser');
  await manage.getByRole('button', { name: 'Replace all images' }).click();
  await (await chooser).setFiles([imageFile('C.png'), imageFile('D.png', 1)]);
  await expect(manage.getByRole('alert')).toContainText('Browser storage is full');
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'C');
  expect(await storedComparison(page)).toEqual(previous);

  await manage.getByRole('button', { name: 'Clear comparison' }).click();
  await expect(manage).toContainText('No images in this comparison.');
  expect(await storedComparison(page)).toEqual({ session: undefined, originals: 0 });
  await changeAlignment(stale, 'Match Width');
  await expect(stale.getByRole('alert')).toContainText('another tab');
  await stale.getByRole('button', { name: '100%', exact: true }).click();
  await expect(stale.getByTestId('stage')).toHaveAttribute('data-zoom', '1');
  expect(await storedComparison(stale)).toEqual({ session: undefined, originals: 0 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeEnabled();
  await expect(page.getByTestId('stage')).toHaveCount(0);
  expect(network).toEqual([]);
});
