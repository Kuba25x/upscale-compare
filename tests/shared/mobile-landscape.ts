import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { imageFile } from '../e2e/fixtures';
import { installWebDisplay } from './web-display';
import { expectLocalComparisonUI } from './local-comparison';

async function open(page: Page) {
  await page.goto('./');
  await page
    .getByTestId('file-input')
    .setInputFiles([imageFile('A.png'), imageFile('B.png', 1), imageFile('C.png')]);
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.comparison-image')
        .evaluateAll((ns) =>
          ns.every((n) => (n as HTMLImageElement).complete && (n as HTMLImageElement).naturalWidth),
        ),
    )
    .toBe(true);
}
async function sourceCenter(page: Page) {
  return page.getByTestId('stage').evaluate((stage) => {
    const box = stage.getBoundingClientRect();
    const image = stage.querySelector('img')!.getBoundingClientRect();
    const side =
      document.querySelector('[aria-label="Side-by-Side"]')?.getAttribute('aria-pressed') ===
      'true';
    const width = side ? (box.width - 1) / 2 : box.width;
    const scale = Number(stage.getAttribute('data-scale'));
    return {
      x: (box.x + width / 2 - image.x) / scale,
      y: (box.y + box.height / 2 - image.y) / scale,
    };
  });
}

export function mobileLandscapeTests() {
  test.describe('mobile landscape uploads and presentation', () => {
    test.beforeEach(async ({ page, browserName }, info) =>
      installWebDisplay(
        page,
        info.title.includes('with angle orientation')
          ? 'angle'
          : info.title.includes('with dimensions orientation')
            ? 'dimensions'
            : 'screen',
        info.title.includes('mouse-first'),
        browserName !== 'chromium',
      ),
    );
    test('keeps one accessible header, an overlay panel and all inspection controls in short landscapes', async ({
      page,
    }) => {
      await open(page);
      for (const viewport of [
        { width: 844, height: 390 },
        { width: 900, height: 412 },
        { width: 500, height: 240 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('.app')).toHaveClass(/comparison-compact/);
        await expect(page.locator('.image-selection-bar')).toBeHidden();
        await expect(page.locator('.image-selection-bar')).not.toHaveClass(/image-panel-open/);
        const header = (await page.locator('.app-header').boundingBox())!;
        expect(header.height).toBe(52);
        const stage = (await page.getByTestId('stage').boundingBox())!;
        expect(stage.height).toBe(viewport.height - 52);
        for (const name of [
          'Split Screen',
          'Side-by-Side',
          'Image controls',
          'Manage Images',
          'Fit',
          'Zoom out',
          'Zoom in',
          'Comparison details',
          'Keyboard shortcuts',
          'Enter fullscreen',
        ]) {
          const control = page.getByRole('button', { name, exact: true });
          await expect(control).toBeInViewport();
          const box = (await control.boundingBox())!;
          expect(box.width, name).toBeGreaterThanOrEqual(44);
          expect(box.height, name).toBeGreaterThanOrEqual(44);
        }
        await expect(page.getByLabel('Zoom preset')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
          viewport.width,
        );
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
          viewport.height,
        );
        const handle = (await page.locator('.divider-handle').boundingBox())!;
        expect(handle.width).toBeGreaterThanOrEqual(44);
        expect(handle.height).toBeGreaterThanOrEqual(44);
        await page.getByRole('button', { name: 'Image controls' }).click();
        await expect(page.getByLabel('Select image A', { exact: true })).toBeVisible();
        expect((await page.getByTestId('stage').boundingBox())!.height).toBe(stage.height);
        await page.getByLabel('Label for image A').focus();
        await page
          .locator('.images-toggle')
          .evaluate((button: HTMLButtonElement) => button.click());
        await expect(page.locator('.images-toggle')).toBeFocused();
        await expect(page.getByLabel('Label for image A')).toBeHidden();
        await page.screenshot({
          path: test.info().outputPath(`landscape-${viewport.width}x${viewport.height}.png`),
        });
      }
    });
    test('keeps A/B, labels, swapping and metadata without sharing controls in the image panel', async ({
      page,
    }) => {
      await open(page);
      await page.setViewportSize({ width: 900, height: 412 });
      await page.getByRole('button', { name: 'Image controls' }).click();
      await page.getByLabel('Select image A', { exact: true }).selectOption('2');
      await page.getByLabel('Label for image A').fill('Native Ultra');
      await page.getByRole('button', { name: 'Swap images', exact: true }).click();
      await expect(page.getByLabel('Select image B', { exact: true })).toHaveValue('2');
      await expect(page.getByLabel('Label for image B')).toHaveValue('Native Ultra');
      await expectLocalComparisonUI(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('.images-toggle')).toBeFocused();
      await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
      await page.getByLabel('Game title').fill('Landscape game');
      await page.getByRole('button', { name: 'Save details', exact: true }).click();
      await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
      await expect(page.getByLabel('Game title')).toHaveValue('Landscape game');
      await page.getByRole('button', { name: 'Save details', exact: true }).click();
      await page.setViewportSize({ width: 412, height: 900 });
      await expect(page.locator('.app')).not.toHaveClass(/comparison-compact/);
      await expectLocalComparisonUI(page);
      await expect(page.getByLabel('Label for image B')).toHaveValue('Native Ultra');
    });
    for (const mode of ['Split Screen', 'Side-by-Side'])
      test(`${mode}: preserves layers, source center, divider and physical pixel zoom through rotation`, async ({
        page,
      }) => {
        await open(page);
        await page.getByRole('button', { name: mode, exact: true }).click();
        await page.getByRole('button', { name: '200%', exact: true }).click();
        if (mode === 'Split Screen') {
          await page.getByRole('slider').focus();
          await page.keyboard.press('ArrowRight');
        }
        const before = await sourceCenter(page);
        const divider =
          mode === 'Split Screen'
            ? await page.getByRole('slider').getAttribute('aria-valuenow')
            : null;
        await page.evaluate(() => {
          const win = window as any;
          win.initialLayers = [...document.querySelectorAll('.comparison-image')];
          win.loads = 0;
          win.initialLayers.forEach((n: HTMLImageElement) =>
            n.addEventListener('load', () => win.loads++),
          );
        });
        for (const viewport of [
          { width: 900, height: 412 },
          { width: 412, height: 900 },
          { width: 500, height: 240 },
        ]) {
          await page.setViewportSize(viewport);
          await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
          await expect
            .poll(async () => Math.abs((await sourceCenter(page)).x - before.x))
            .toBeLessThanOrEqual(1);
          await expect
            .poll(async () => Math.abs((await sourceCenter(page)).y - before.y))
            .toBeLessThanOrEqual(1);
        }
        if (mode === 'Split Screen')
          await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', divider!);
        const ratio = await page.evaluate(() => devicePixelRatio);
        for (const zoom of [1, 2, 4]) {
          await page.getByLabel('Zoom preset').selectOption(String(zoom));
          await expect
            .poll(async () => (await page.getByTestId('image-A').boundingBox())!.width * ratio)
            .toBeCloseTo(640 * zoom, 1);
        }
        await page.getByRole('button', { name: 'Fit', exact: true }).click();
        const stage = (await page.getByTestId('stage').boundingBox())!;
        await expect
          .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-scale')))
          .toBeCloseTo(
            Math.min(
              (mode === 'Split Screen' ? stage.width : (stage.width - 1) / 2) / 640,
              stage.height / 480,
            ),
            4,
          );
        expect(
          await page.evaluate(
            () =>
              [...document.querySelectorAll('.comparison-image')].every(
                (n, i) => n === (window as any).initialLayers[i],
              ) && (window as any).loads === 0,
          ),
        ).toBe(true);
      });
    test('cancels contacts on a changed stage rectangle and retains exact pixels in compact mode', async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'Physical pixel sampling and touch injection use Chromium CDP.',
      );
      await open(page);
      await page.setViewportSize({ width: 900, height: 412 });
      await page.getByLabel('Zoom preset').selectOption('1');
      const image = (await page.getByTestId('image-A').boundingBox())!;
      const ratio = await page.evaluate(() => devicePixelRatio);
      const shot = PNG.sync.read(await page.screenshot());
      const offset =
        ((Math.round(image.y * ratio) + 132) * shot.width + Math.round(image.x * ratio) + 70) * 4;
      expect([...shot.data.subarray(offset, offset + 4)]).toEqual([70, 132, 80, 255]);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: 180, y: 150, id: 1 },
          { x: 280, y: 150, id: 2 },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: 160, y: 150, id: 1 },
          { x: 300, y: 150, id: 2 },
        ],
      });
      await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1.4');
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
      const before = await sourceCenter(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: 140, y: 150, id: 1 },
          { x: 320, y: 150, id: 2 },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1.4');
      expect(await sourceCenter(page)).toEqual(before);
      await cdp.detach();
    });
    test('handles a resolution change notification without rotation or a stage resize', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'DPR changes use Chromium CDP.');
      await open(page);
      await page.setViewportSize({ width: 900, height: 412 });
      await page.getByLabel('Zoom preset').selectOption('2');
      const before = await sourceCenter(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 100, y: 150, id: 1 }],
      });
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 412,
        deviceScaleFactor: 3,
        mobile: true,
        screenOrientation: { type: 'landscapePrimary', angle: 90 },
      });
      // CDP changes DPR without emitting the resolution notification a real browser delivers.
      await page.evaluate(() =>
        (window as any).testResolutionQueries.forEach((query: MediaQueryList) =>
          query.dispatchEvent(new Event('change')),
        ),
      );
      await expect
        .poll(async () => (await page.getByTestId('image-A').boundingBox())!.width * 3)
        .toBeCloseTo(1280, 1);
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
      await expect
        .poll(async () => Math.abs((await sourceCenter(page)).x - before.x))
        .toBeLessThanOrEqual(1);
      await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    });
    test('protects cutouts and adapts panels and metadata dialogs to the visual keyboard viewport', async ({
      page,
    }) => {
      await open(page);
      await page.setViewportSize({ width: 900, height: 412 });
      await page.addStyleTag({
        content:
          '.web-app { --comparison-safe-top:18px; --comparison-safe-right:46px; --comparison-safe-bottom:16px; --comparison-safe-left:24px; }',
      });
      await expect
        .poll(async () => (await page.locator('.app-header').boundingBox())!.height)
        .toBe(70);
      await expect
        .poll(async () => Math.abs((await sourceCenter(page)).y - 240))
        .toBeLessThanOrEqual(1);
      const before = await sourceCenter(page);
      await page.getByRole('button', { name: 'Image controls' }).click();
      await page.getByLabel('Label for image A').focus();
      await page.evaluate(() => {
        (window as any).testVisualViewport = { height: 240, offsetTop: 20 };
        visualViewport!.dispatchEvent(new Event('resize'));
      });
      await expect
        .poll(() =>
          page
            .locator('html')
            .evaluate((node) => getComputedStyle(node).getPropertyValue('--web-visual-height')),
        )
        .toBe('240px');
      await expect
        .poll(async () => (await page.locator('.image-selection-bar').boundingBox())!.y)
        .toBeGreaterThanOrEqual(70);
      const toolbar = (await page.locator('.inspection-toolbar').boundingBox())!;
      expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(900 - 46);
      expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(260);
      await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
      await expect
        .poll(async () => (await page.getByRole('dialog').boundingBox())!.height)
        .toBeLessThanOrEqual(182);
      const dialog = (await page.getByRole('dialog').boundingBox())!;
      expect(dialog.y).toBeGreaterThanOrEqual(38);
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(244);
      expect(await sourceCenter(page)).toEqual(before);
    });
    for (const source of ['screen', 'angle', 'dimensions'] as const)
      test(`does not mistake the portrait keyboard for rotation with ${source} orientation`, async ({
        page,
      }) => {
        // Install before navigation; source-specific fallback must also survive height-only resize.
        await page.goto('./');
        await page.evaluate(() => {
          (window as any).testOrientation = 'portrait-primary';
        });
        await page.setViewportSize({ width: 412, height: 280 });
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        await expect(page.locator('.app')).not.toHaveClass(/comparison-compact/);
      });
    test('keeps mouse-first touchscreen desktops out of the compact layout', async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 412 });
      await open(page);
      await expect(page.locator('.app')).not.toHaveClass(/comparison-compact/);
      await expect(page.getByRole('button', { name: '100%', exact: true })).toBeVisible();
    });
  });
}
