import { test, expect, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { installAndroidBridge } from './bridge';

const files = [imageFile('A.png', 0), imageFile('B.png', 1), imageFile('C.png', 0)];
async function open(page: Page) {
  await page.route('**/original-*.png', (route) => {
    const index = Number(new URL(route.request().url()).pathname.match(/original-(\d+)/)![1]);
    return route.fulfill({ contentType: 'image/png', body: files[index].buffer });
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
  await insets(page, {
    statusTop: 32,
    navigationBottom: 24,
    cutoutTop: 30,
    gestureLeft: 8,
    gestureRight: 8,
  });
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await expect(page.getByTestId('image-A')).toBeVisible();
}
async function insets(page: Page, values: Record<string, number>) {
  await page.evaluate((values) => {
    (window as any).displayInsets = values;
    (window as any).emitDisplayState();
  }, values);
}
async function config(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('test-session')!).config);
}
async function assertBars(page: Page, status: boolean, navigation: boolean) {
  // Protocol assertions only. Actual system bars/cutouts are checked by instrumentation.
  await expect
    .poll(() =>
      page.evaluate(() => [
        (window as any).displayState.statusVisible,
        (window as any).displayState.navigationVisible,
      ]),
    )
    .toEqual([status, navigation]);
}
async function box(page: Page, selector: string) {
  return (await page.locator(selector).boundingBox())!;
}
test('all four display modes use inset-aware controls and an edge-to-edge image surface', async ({
  page,
}) => {
  await open(page);
  await assertBars(page, true, true);
  expect((await box(page, '.app-header h1')).y).toBeGreaterThanOrEqual(32);
  await expect(page.getByRole('button', { name: 'Image controls' })).toBeHidden();
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await assertBars(page, false, true);
  expect((await box(page, '.stage')).y).toBe(0);
  expect((await box(page, '.stage')).height).toBe(876);
  expect((await box(page, '.android-fullscreen-exit')).y + 48).toBe(864);
  await page.setViewportSize({ width: 900, height: 412 });
  for (const side of ['cutoutLeft', 'cutoutRight']) {
    await insets(page, { [side]: 46, gestureLeft: 12, gestureRight: 12, gestureBottom: 18 });
    await assertBars(page, false, false);
    expect(await box(page, '.stage')).toMatchObject({ x: 0, y: 0, width: 900, height: 412 });
    const exit = await box(page, '.android-fullscreen-exit');
    expect(exit.x + exit.width).toBe(900 - 12 - (side === 'cutoutRight' ? 46 : 12));
    expect(exit.y + exit.height).toBe(412 - 18 - 12);
    await expect(page.locator('button:visible')).toHaveCount(1);
    await page.getByRole('slider').focus();
    await page.keyboard.press(side === 'cutoutLeft' ? 'Home' : 'End');
    const handle = await box(page, '.divider-handle');
    expect(handle.x).toBeGreaterThanOrEqual(side === 'cutoutLeft' ? 46 : 12);
    expect(handle.x + handle.width).toBeLessThanOrEqual(900 - (side === 'cutoutRight' ? 46 : 12));
  }
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await assertBars(page, false, false);
  await expect(page.locator('.android-comparison-fullscreen')).toHaveCount(0);
  expect((await box(page, '.app-header')).height).toBe(52);
  expect((await box(page, '.stage')).height).toBeGreaterThan(412 * 0.8);
  expect((await box(page, '.stage')).x).toBe(0);
  expect((await box(page, '.stage')).width).toBe(900);
  const header = await box(page, '.app-header');
  for (const selector of ['.app-header h1', '.mode-controls', '.header-actions']) {
    const control = await box(page, selector);
    expect(control.y).toBeGreaterThanOrEqual(header.y);
    expect(control.y + control.height).toBeLessThanOrEqual(header.y + header.height);
    expect(control.x + control.width).toBeLessThanOrEqual(900 - 46);
    expect(control.x).toBeGreaterThanOrEqual(12);
  }
  const toolbar = await box(page, '.inspection-toolbar');
  const stage = await box(page, '.stage');
  expect(toolbar.height).toBeLessThanOrEqual(50);
  expect(stage.y + stage.height - toolbar.y - toolbar.height).toBe(26);
  await expect(page.locator('.image-selection-bar')).toBeHidden();
  await page.screenshot({ path: 'test-results/android/compact-landscape-right-cutout.png' });
  await page.setViewportSize({ width: 500, height: 240 });
  await insets(page, { cutoutLeft: 46, gestureRight: 12, gestureBottom: 12 });
  const logo = await box(page, '.app-header .brand-mark');
  expect(logo.x).toBeGreaterThanOrEqual(46);
  expect(
    (await box(page, '.header-actions')).x + (await box(page, '.header-actions')).width,
  ).toBeLessThanOrEqual(500 - 12);
  expect(
    await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
    ]),
  ).toEqual([500, 240]);
  await page.setViewportSize({ width: 412, height: 900 });
  await insets(page, { statusTop: 32, navigationBottom: 24, cutoutTop: 30 });
  await assertBars(page, true, true);
  await expect(page.locator('.image-selection-bar')).toBeVisible();
});

test('compact image controls allow selection, swapping and labels, with modal and Back routing', async ({
  page,
}) => {
  await open(page);
  await page.setViewportSize({ width: 900, height: 412 });
  await insets(page, { cutoutLeft: 46, gestureRight: 12, gestureBottom: 18 });
  const trigger = page.getByRole('button', { name: 'Image controls' });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Select image A', { exact: true }).selectOption('2');
  await expect.poll(async () => (await config(page)).selected).toEqual([2, 1]);
  await page.getByLabel('Label for image A').fill('Alternative A');
  await page.getByRole('button', { name: 'Swap images' }).click();
  await expect.poll(async () => (await config(page)).selected).toEqual([1, 2]);
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(page.locator('.image-selection-bar')).toBeHidden();
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  const dialog = await box(page, '.modal');
  expect(dialog.x).toBeGreaterThanOrEqual(46);
  expect(dialog.x + dialog.width).toBeLessThanOrEqual(900 - 12);
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await page.evaluate(() => {
    (window as any).cancelPick = true;
  });
  await page.getByRole('button', { name: 'Replace all images' }).click();
  await expect.poll(async () => (await config(page)).selected).toEqual([1, 2]);
  await assertBars(page, false, false);
});

for (const mode of ['Split Screen', 'Side-by-Side']) {
  test(`${mode}: rotation and zoom presets preserve source state and image nodes`, async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.setViewportSize({ width: 900, height: 412 });
    await insets(page, { cutoutLeft: 46, gestureRight: 12, gestureBottom: 18 });
    expect(
      await page.getByLabel('Zoom preset', { exact: true }).evaluate((select) => {
        const event = new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'touch',
          button: 0,
        });
        select.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
    await page.evaluate(() => {
      (window as any).initialLayers = [...document.querySelectorAll('.comparison-image')];
      (window as any).loads = 0;
      (window as any).initialLayers.forEach((i: HTMLImageElement) =>
        i.addEventListener('load', () => (window as any).loads++),
      );
    });
    for (const zoom of [1, 2, 4]) {
      await page.getByLabel('Zoom preset', { exact: true }).selectOption(String(zoom));
      await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', String(zoom));
      const stage = await box(page, '.stage');
      await page.mouse.move(stage.x + 150, stage.y + 100);
      await page.mouse.down();
      await page.mouse.move(stage.x + 170, stage.y + 120);
      await page.mouse.up();
      await expect.poll(async () => (await config(page)).view.zoom).toBe(zoom);
      const before = await config(page);
      await page.getByRole('button', { name: 'Enter fullscreen' }).click();
      await page.setViewportSize({ width: 412, height: 900 });
      await insets(page, { statusTop: 32, navigationBottom: 24, cutoutTop: 30 });
      await assertBars(page, false, true);
      await expect.poll(() => config(page)).toEqual(before);
      const image = await box(page, '[data-testid="image-A"]');
      expect(image.width * 3).toBeCloseTo(640 * zoom, 1);
      await page.setViewportSize({ width: 900, height: 412 });
      await insets(page, { cutoutRight: 46, gestureLeft: 12, gestureBottom: 18 });
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await expect.poll(() => config(page)).toEqual(before);
    }
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const before = await config(page);
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect
      .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-scale')))
      .toBeCloseTo(Math.min((mode === 'Split Screen' ? 900 : 449.5) / 640, 412 / 480), 4);
    await expect.poll(() => config(page)).toEqual(before);
    expect(
      await page.evaluate(
        () =>
          [...document.querySelectorAll('.comparison-image')].every(
            (i, n) => i === (window as any).initialLayers[n],
          ) && (window as any).loads === 0,
      ),
    ).toBe(true);
  });
}
