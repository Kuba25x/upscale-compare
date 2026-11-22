import { test, expect } from '@playwright/test';
import { imageFile, openComparison } from './fixtures';
import { expectLocalComparisonUI } from '../shared/local-comparison';
import {
  expectCenteredDividerArrows,
  expectSplitPosition,
  expectSplitRange,
} from '../shared/layout-alignment';
import { installWebDisplay } from '../shared/web-display';
test('mobile keeps all main controls accessible without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'test-results/landing-mobile.png' });
  await openComparison(page);
  await expectLocalComparisonUI(page);
  for (const name of ['Split Screen', 'Side-by-Side', 'Manage Images'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('combobox', { name: 'Zoom preset' }).selectOption('1');
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1');
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).tap();
  await expect(page.getByTestId('image-A')).toBeVisible();
  await page.screenshot({ path: 'test-results/viewer-mobile.png' });
});
test('touch divider and synchronized pinch navigation respond to touch input', async ({ page }) => {
  await openComparison(page);
  await expectCenteredDividerArrows(page);
  const stage = await page.getByTestId('stage').boundingBox();
  const client = await page.context().newCDPSession(page);
  const y = Math.round(stage!.y + stage!.height / 2),
    center = Math.round(stage!.x + stage!.width / 2);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: center, y, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 280, y, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('slider')).toHaveAttribute(
    'aria-valuenow',
    String(Math.round(((280 - stage!.x) / stage!.width) * 100)),
  );
  await page.keyboard.press('q');
  await expect(page.getByTestId('stage')).toBeFocused();
  await expect(page.getByRole('slider')).not.toBeFocused();
  await expect(page.locator('.divider-handle')).toHaveCSS('outline-style', 'none');
  await page.getByRole('combobox', { name: 'Zoom preset' }).selectOption('1');
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 70, y: y - 60, id: 1 },
      { x: 150, y: y - 60, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 45, y: y - 60, id: 1 },
      { x: 175, y: y - 60, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect
    .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-zoom')))
    .toBeGreaterThan(1);
  const a = await page.getByTestId('image-A').boundingBox(),
    b = await page.getByTestId('image-B').boundingBox();
  expect(a).toEqual(b);
});

test('touch can pull the clipped divider inward from either edge and recover after cancellation', async ({
  page,
}) => {
  await installWebDisplay(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await openComparison(page);
  await expectSplitRange(page);
  const slider = page.getByRole('slider', { name: 'Comparison divider' });
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const y = Math.round(stage.y + stage.height / 2);
  const physicalPixel = await page.evaluate(() => 1 / devicePixelRatio);
  const client = await page.context().newCDPSession(page);
  for (const [key, edge, grip, target] of [
    ['Home', 0, stage.x + 6, stage.x + stage.width - physicalPixel],
    ['End', 100, stage.x + stage.width - 6, stage.x + physicalPixel],
  ] as const) {
    await slider.press(key);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: grip, y, id: 1 }],
    });
    await expectSplitPosition(page, edge);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: target, y, id: 1 }],
    });
    await expectSplitPosition(page, 100 - edge);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expectSplitPosition(page, 100 - edge);
  }
  await client.detach();
  await page.setViewportSize({ width: 500, height: 240 });
  await expect(page.locator('.app')).toHaveClass(/comparison-phone-landscape/);
  await expectSplitRange(page);
});

test('phone portrait zoom picker preserves physical-pixel presets and displays intermediate zoom', async ({
  page,
}) => {
  await openComparison(page);
  const stage = page.getByTestId('stage');
  const zoom = page.getByRole('combobox', { name: 'Zoom preset' });
  const selected = zoom.locator('option:checked');
  await expect(selected).toHaveText('Fit');
  const dpr = await page.evaluate(() => devicePixelRatio);
  for (const preset of [1, 2, 4]) {
    await zoom.selectOption(String(preset));
    await expect(selected).toHaveText(`${preset * 100}%`);
    await expect(stage).toHaveAttribute('data-zoom', String(preset));
    expect((await page.getByTestId('image-A').boundingBox())!.width * dpr).toBeCloseTo(
      640 * preset,
      2,
    );
  }
  await zoom.selectOption('1');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).tap();
  await expect(selected).toHaveText('125%');
  await page.getByRole('button', { name: 'Zoom out', exact: true }).tap();
  await expect(selected).toHaveText('100%');

  const box = (await stage.boundingBox())!;
  const y = Math.round(box.y + box.height / 4);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 66, y, id: 1 },
      { x: 166, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 26, y, id: 1 },
      { x: 207, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(selected).toHaveText('181%');
  await expect(selected).toBeDisabled();

  await page.mouse.move(box.x + 80, y);
  await page.mouse.wheel(0, -50);
  await expect(selected).not.toHaveText('181%');
  const wheelZoom = Number(await stage.getAttribute('data-zoom'));
  expect(wheelZoom).toBeGreaterThan(1.81);
  await expect(selected).toHaveText(`${Math.round(wheelZoom * 100)}%`);

  const fit = page.getByRole('button', { name: 'Fit', exact: true });
  await fit.tap();
  await expect(selected).toHaveText('Fit');
  await expect(stage).toHaveAttribute('data-zoom', 'fit');
  await expect(fit).toHaveClass('selected');
});

test('image management wraps at 320 px and remains usable in short landscape', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles(
      [0, 1, 2, 3].map((i) => imageFile(`Screenshot with a long filename ${i}.png`, i % 2)),
    );
  await page.getByRole('button', { name: 'Manage Images', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Your images' });
  const rowAction = dialog.getByRole('button', { name: /^Remove image / }).first();
  const fits = () => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth);
  expect(await fits()).toBe(true);
  expect((await rowAction.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await rowAction.tap();
  await page.setViewportSize({ width: 600, height: 320 });
  expect(await fits()).toBe(true);
  await dialog.getByRole('button', { name: 'Clear comparison' }).tap();
  await expect(dialog.getByRole('button', { name: 'Add images' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close dialog' }).tap();
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeVisible();
});
