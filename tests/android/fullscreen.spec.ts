import { test, expect, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { installAndroidBridge } from './bridge';

const files = [imageFile(), imageFile('B.png', 1, 512, 384), imageFile('C.png', 0, 320, 256)];
async function openComparison(page: Page, mode: string) {
  const requests: string[] = [];
  await page.route('**/original-*.png', (route) => {
    requests.push(route.request().url());
    const index = Number(new URL(route.request().url()).pathname.match(/original-(\d+)/)![1]);
    return route.fulfill({ contentType: 'image/png', body: files[index].buffer });
  });
  await installAndroidBridge(
    page,
    files.map((file, i) => ({
      name: file.name,
      type: file.mimeType,
      width: [640, 512, 320][i],
      height: [480, 384, 256][i],
      size: file.buffer.length,
    })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await page.getByLabel('Select image A', { exact: true }).selectOption('2');
  await page.getByLabel('Select image B', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: mode, exact: true }).click();
  await expect
    .poll(() => page.getByTestId('image-A').evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(320);
  await expect(page.locator('.alignment-warning')).toBeVisible();
  await expect
    .poll(() => savedConfig(page))
    .toMatchObject({
      selected: [2, 0],
      mode: mode === 'Split Screen' ? 'split' : 'side',
    });
  return requests;
}
async function savedConfig(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('test-session')!).config);
}
async function snapshotImages(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('.comparison-image')
        .evaluateAll((nodes) =>
          nodes.every(
            (node) =>
              (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const win = window as any;
    win.originalLayers = [...document.querySelectorAll('.comparison-image')];
    win.layerSources = win.originalLayers.map((image: HTMLImageElement) => image.currentSrc);
    win.imageLoads = 0;
    win.originalLayers.forEach((image: HTMLImageElement) =>
      image.addEventListener('load', () => win.imageLoads++),
    );
  });
}
async function assertOriginalLayers(page: Page) {
  expect(
    await page.evaluate(() => {
      const win = window as any;
      return [...document.querySelectorAll('.comparison-image')].every(
        (image, i) =>
          image === win.originalLayers[i] &&
          (image as HTMLImageElement).currentSrc === win.layerSources[i],
      );
    }),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).imageLoads)).toBe(0);
}
async function assertFullscreen(page: Page, mode: string) {
  await expect(page.locator('.android-comparison-fullscreen')).toBeVisible();
  for (const selector of [
    '.app-header',
    '.mode-controls',
    '.header-actions',
    '.image-selection-bar',
    '.image-badge',
    '.alignment-warning',
    '.inspection-toolbar',
    '.demo-notice',
    '.landing-footer',
  ])
    await expect(page.locator(`${selector}:visible`)).toHaveCount(0);
  await expect(page.locator('button:visible')).toHaveCount(1);
  const exit = page.getByRole('button', { name: 'Exit fullscreen', exact: true });
  await expect(exit).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(mode === 'Split Screen' ? 1 : 0);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const target = (await exit.boundingBox())!;
  expect(stage.x).toBe(0);
  expect(stage.y).toBe(0);
  expect(stage.width).toBe(page.viewportSize()!.width);
  expect(stage.height).toBe(page.viewportSize()!.height);
  expect(target.width).toBeGreaterThanOrEqual(48);
  expect(target.height).toBeGreaterThanOrEqual(48);
  expect(stage.x + stage.width - target.x - target.width).toBeCloseTo(12, 0);
  expect(stage.y + stage.height - target.y - target.height).toBeCloseTo(12, 0);
  expect(
    await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
    ]),
  ).toEqual([page.viewportSize()!.width, page.viewportSize()!.height]);
  expect(await page.evaluate(() => (window as any).barsHidden)).toBe(false);
  expect(await page.evaluate(() => (window as any).systemBarCalls)).not.toContain('hide');
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  if (mode === 'Split Screen') {
    const handle = (await page.locator('.divider-handle').boundingBox())!;
    expect(target.y).toBeGreaterThan(handle.y + handle.height);
  }
}
async function pan(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}
async function assertScale(page: Page, zoom: number) {
  // Chromium layout quantizes bounding boxes to 1/64 CSS px (less than 0.05 physical px at DPR 3).
  const a = (await page.getByTestId('image-A').boundingBox())!;
  const b = (await page.getByTestId('image-B').boundingBox())!;
  expect(a.width * 3).toBeCloseTo(320 * zoom, 1);
  expect(a.height * 3).toBeCloseTo(256 * zoom, 1);
  expect(b.width * 3).toBeCloseTo(640 * zoom, 1);
  expect(b.height * 3).toBeCloseTo(480 * zoom, 1);
  expect(a.y).toBeCloseTo(b.y, 4);
}
for (const mode of ['Split Screen', 'Side-by-Side']) {
  test(`${mode}: Android comparison-only fullscreen preserves geometry, layers and system bars`, async ({
    page,
  }) => {
    const requests = await openComparison(page, mode);
    await expect(page.locator('.android-fullscreen-exit')).toHaveCount(0);
    const enter = page.getByRole('button', { name: 'Enter fullscreen' });
    await expect(page.locator('.inspection-toolbar > button').last()).toHaveAccessibleName(
      'Enter fullscreen',
    );
    const buttonBounds = await page
      .locator('.inspection-toolbar > button')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x));
    expect(buttonBounds.at(-1)).toBe(Math.max(...buttonBounds));
    await page.getByRole('button', { name: '200%', exact: true }).click();
    const normal = (await page.getByTestId('stage').boundingBox())!;
    await pan(page, normal.x + 50, normal.y + normal.height / 2, 24, 17);
    if (mode === 'Split Screen') {
      await page.getByRole('slider').focus();
      await page.keyboard.press('ArrowRight');
    }
    await expect.poll(async () => (await savedConfig(page)).view.zoom).toBe(2);
    const before = await savedConfig(page);
    await snapshotImages(page);
    const requestCount = requests.length;
    await enter.click();
    await assertFullscreen(page, mode);
    await assertScale(page, 2);
    await page.screenshot({
      path: `test-results/android/${mode === 'Split Screen' ? 'split' : 'side'}-fullscreen-portrait.png`,
    });
    await expect.poll(() => savedConfig(page)).toEqual(before);
    // Tapping the image never reveals controls.
    await page.getByTestId('stage').tap({ position: { x: 60, y: 120 } });
    await assertFullscreen(page, mode);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 70, y: 250, id: 1 }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 95, y: 270, id: 1 }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => (await savedConfig(page)).view.center)
      .not.toEqual(before.view.center);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: 70, y: 250, id: 1 },
        { x: 70, y: 330, id: 2 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 70, y: 230, id: 1 },
        { x: 70, y: 350, id: 2 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '3');
    await assertScale(page, 3);
    await client.detach();
    if (mode === 'Split Screen') {
      const divider = (await page.getByRole('slider').boundingBox())!;
      await pan(page, divider.x + divider.width / 2, 450, 80, 0);
      await expect
        .poll(async () => (await savedConfig(page)).divider)
        .toBeGreaterThan(before.divider);
    }
    await expect.poll(async () => (await savedConfig(page)).view.zoom).toBe(3);
    const fullscreenConfig = await savedConfig(page);
    await page.mouse.move(60, 120);
    await page.mouse.down();
    await page.setViewportSize({ width: 900, height: 412 });
    await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
    await page.mouse.move(80, 140);
    await page.mouse.up();
    await assertFullscreen(page, mode);
    await assertScale(page, 3);
    await page.screenshot({
      path: `test-results/android/${mode === 'Split Screen' ? 'split' : 'side'}-fullscreen-landscape.png`,
    });
    await expect.poll(() => savedConfig(page)).toEqual(fullscreenConfig);
    await page.setViewportSize({ width: 412, height: 900 });
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.image-selection-bar')).toBeVisible();
    await expect(page.locator('.inspection-toolbar')).toBeVisible();
    await expect(page.locator('.android-fullscreen-exit')).toHaveCount(0);
    await expect.poll(() => savedConfig(page)).toEqual(fullscreenConfig);
    await assertOriginalLayers(page);
    expect(requests).toHaveLength(requestCount);
    // System Back exits fullscreen first; modal Back outside fullscreen still closes the modal.
    await enter.click();
    await assertFullscreen(page, mode);
    await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
    await expect(page.locator('.app-header')).toBeVisible();
    await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => savedConfig(page)).toEqual(fullscreenConfig);
  });
  test(`${mode}: Fit adapts to Android fullscreen and landscape without changing its source center`, async ({
    page,
  }) => {
    await openComparison(page, mode);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect.poll(async () => (await savedConfig(page)).view.zoom).toBeNull();
    const before = await savedConfig(page);
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    for (const viewport of [
      { width: 412, height: 900 },
      { width: 900, height: 412 },
      { width: 500, height: 240 },
    ]) {
      await page.setViewportSize(viewport);
      await assertFullscreen(page, mode);
      const scale = Math.min(
        (mode === 'Split Screen' ? viewport.width : (viewport.width - 1) / 2) / 640,
        viewport.height / 480,
      );
      await expect
        .poll(() =>
          page.getByTestId('image-B').evaluate((node) => node.getBoundingClientRect().width),
        )
        .toBeCloseTo(640 * scale, 1);
      await expect.poll(() => savedConfig(page)).toEqual(before);
    }
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await page.setViewportSize({ width: 412, height: 900 });
    await expect.poll(() => savedConfig(page)).toEqual(before);
  });
}
