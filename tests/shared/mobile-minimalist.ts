import { test, expect, type Page } from '@playwright/test';
import { chooseZoomPreset, renameSelectedImage } from './phone-controls';
import { PNG } from 'pngjs';
import { imageFile } from '../e2e/fixtures';
import { installWebDisplay } from './web-display';
import { installFullscreen, type FullscreenOutcome } from './web-fullscreen';

const files = [
  imageFile('A.png'),
  imageFile('B.png', 1, 512, 384),
  imageFile('C.png', 0, 320, 256),
];
export async function open(page: Page, mode = 'Split Screen', url = './') {
  await page.goto(url);
  await page.getByTestId('file-input').setInputFiles(files);
  await page.getByLabel('Select image A', { exact: true }).selectOption('2');
  await page.getByLabel('Select image B', { exact: true }).selectOption('0');
  await renameSelectedImage(page, 'A', 'C.png', 'Native original');
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await page.getByLabel('Game title').fill('Minimalist regression');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.getByRole('button', { name: mode, exact: true }).click();
  await chooseZoomPreset(page, 2);
  if (mode === 'Split Screen') {
    await page.getByRole('slider').focus();
    await page.keyboard.press('ArrowRight');
  }
  await expect
    .poll(() =>
      page
        .locator('.comparison-image')
        .evaluateAll((nodes) =>
          nodes.every(
            (n) => (n as HTMLImageElement).complete && (n as HTMLImageElement).naturalWidth,
          ),
        ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const win = window as any;
    win.originalLayers = [...document.querySelectorAll('.comparison-image')];
    win.originalSources = win.originalLayers.map((n: HTMLImageElement) => n.currentSrc);
    win.imageLoads = 0;
    win.originalLayers.forEach((n: HTMLImageElement) =>
      n.addEventListener('load', () => win.imageLoads++),
    );
  });
}
export async function snapshot(page: Page) {
  return page.getByTestId('stage').evaluate((stage) => {
    const rect = stage.getBoundingClientRect();
    const image = stage.querySelector('img')!.getBoundingClientRect();
    const side =
      document.querySelector('[aria-label="Side-by-Side"]')?.getAttribute('aria-pressed') ===
      'true';
    const panelWidth = side ? (rect.width - 1) / 2 : rect.width;
    const scale = Number(stage.getAttribute('data-scale'));
    return {
      mode: side ? 'side' : 'split',
      zoom: stage.getAttribute('data-zoom'),
      selected: [...document.querySelectorAll('#image-controls select')].map(
        (n) => (n as HTMLSelectElement).value,
      ),
      labels: [...document.querySelectorAll<HTMLSelectElement>('#image-controls select')].map(
        (select) => select.selectedOptions[0].textContent,
      ),
      divider: stage.querySelector('[role="slider"]')?.getAttribute('aria-valuenow') ?? null,
      x: (rect.x + panelWidth / 2 - image.x) / scale,
      y: (rect.y + rect.height / 2 - image.y) / scale,
    };
  });
}
export async function unchanged(page: Page, before: Awaited<ReturnType<typeof snapshot>>) {
  await expect
    .poll(async () => {
      const after = await snapshot(page);
      return { ...after, x: before.x, y: before.y };
    })
    .toEqual(before);
  await expect
    .poll(async () => Math.abs((await snapshot(page)).x - before.x))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(async () => Math.abs((await snapshot(page)).y - before.y))
    .toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('.comparison-image')].every(
          (n, i) =>
            n === (window as any).originalLayers[i] &&
            (n as HTMLImageElement).currentSrc === (window as any).originalSources[i],
        ) && (window as any).imageLoads === 0,
    ),
  ).toBe(true);
}
async function minimal(page: Page, mode = 'Split Screen') {
  await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
  for (const selector of [
    '.app-header',
    '.image-selection-bar',
    '.image-badge',
    '.alignment-warning',
    '.inspection-toolbar',
    '.published-notice',
  ])
    await expect(page.locator(`${selector}:visible`)).toHaveCount(0);
  await expect(page.locator('button:visible')).toHaveCount(1);
  const exit = page.getByRole('button', { name: 'Exit fullscreen', exact: true });
  await expect(exit).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('slider')).toHaveCount(mode === 'Split Screen' ? 1 : 0);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  expect(stage.x).toBe(0);
  expect(stage.y).toBe(0);
  // Firefox can expand its real viewport to the screen while Playwright retains its configured size.
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(stage.width).toBe(viewport.width);
  expect(stage.height).toBe(viewport.height);
  const box = (await exit.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(48);
  expect(box.height).toBeGreaterThanOrEqual(48);
  await expect(exit).toBeInViewport();
}

export function mobileMinimalistTests() {
  test.describe('mobile minimalist uploads and comparison', () => {
    const errors = new WeakMap<Page, string[]>();
    test.beforeEach(async ({ page, browserName }) => {
      await installWebDisplay(page, 'screen', false, browserName !== 'chromium');
      const observed: string[] = [];
      errors.set(page, observed);
      page.on('pageerror', (error) => observed.push(error.message));
      await page.addInitScript(() => {
        Object.defineProperty(window, 'Capacitor', {
          get() {
            throw new Error('Web must not initialize Capacitor');
          },
        });
        Object.defineProperty(screen.orientation, 'lock', {
          value() {
            throw new Error('Web must not lock orientation');
          },
        });
      });
    });
    test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

    for (const mode of ['Split Screen', 'Side-by-Side']) {
      for (const outcome of ['success', 'missing', 'reject', 'throw'] as FullscreenOutcome[])
        test(`${mode}: API ${outcome} preserves comparison-only presentation and restores focus`, async ({
          page,
        }) => {
          await installFullscreen(page, outcome);
          await open(page, mode);
          const before = await snapshot(page);
          await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
          await minimal(page, mode);
          await unchanged(page, before);
          expect(
            await page.evaluate(() => document.fullscreenElement === document.documentElement),
          ).toBe(outcome === 'success');
          if (outcome !== 'missing')
            expect(await page.evaluate(() => (window as any).fullscreenCalls[0].active)).not.toBe(
              false,
            );
          await page.getByTestId('stage').click({ position: { x: 50, y: 80 } });
          await page.keyboard.press('?');
          await minimal(page, mode);
          // No hidden toolbar/panel control may retain keyboard focus.
          for (let tab = 0; tab < 4; tab++) {
            await page.keyboard.press('Tab');
            expect(
              await page.evaluate(
                () =>
                  document.activeElement === document.body ||
                  document.activeElement?.matches('.stage,[role="slider"],.minimalist-exit'),
              ),
            ).toBe(true);
          }
          if (outcome === 'success')
            await page.evaluate(() => (window as any).systemFullscreenExit());
          else if (outcome === 'reject') {
            await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).focus();
            await page.keyboard.press('Escape');
          } else await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
          await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
          await expect(
            page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
          ).toBeFocused();
          await unchanged(page, before);
          await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
          await expect(page.getByLabel('Game title')).toHaveValue('Minimalist regression');
        });
      test(`${mode}: zoom, Fit and image identity survive both rotations and safe insets in CSS fallback`, async ({
        page,
        browserName,
      }) => {
        await installFullscreen(page, 'missing');
        await open(page, mode);
        const original = await snapshot(page);
        for (const zoom of [1, 2, 4]) {
          await page.setViewportSize({ width: 412, height: 900 });
          // The zoom selector is visible in both orientations. Wait for the portrait layout.
          await expect(page.locator('.app')).toHaveClass(/comparison-phone-portrait/);
          await page.getByRole('combobox', { name: 'Zoom preset' }).selectOption(String(zoom));
          const before = { ...original, zoom: String(zoom) };
          // Check the original center after the viewer has measured the resized stage.
          await unchanged(page, before);
          await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
          for (const viewport of [
            { width: 412, height: 900 },
            { width: 900, height: 412 },
            { width: 500, height: 240 },
            { width: 1280, height: 720 },
          ]) {
            await page.setViewportSize(viewport);
            await page.addStyleTag({
              content:
                '.web-app { --comparison-safe-top:30px; --comparison-safe-left:24px; --comparison-safe-right:46px; --comparison-safe-bottom:18px; }',
            });
            await minimal(page, mode);
            await unchanged(page, before);
            const ratio = await page.evaluate(() => devicePixelRatio);
            await expect
              .poll(async () => (await page.getByTestId('image-A').boundingBox())!.width * ratio)
              .toBeCloseTo(320 * zoom, 1);
            if (zoom === 1 && viewport.width === 900 && browserName === 'chromium') {
              const image = (await page.getByTestId('image-A').boundingBox())!;
              const shot = PNG.sync.read(await page.screenshot());
              const offset =
                ((Math.round(image.y * ratio) + 132) * shot.width +
                  Math.round(image.x * ratio) +
                  70) *
                4;
              expect([...shot.data.subarray(offset, offset + 4)]).toEqual([70, 132, 80, 255]);
            }
            const exit = (await page.locator('.minimalist-exit').boundingBox())!;
            expect(exit.x + exit.width).toBeLessThanOrEqual(viewport.width - 46);
            expect(exit.y + exit.height).toBeLessThanOrEqual(viewport.height - 18);
          }
          await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
          await unchanged(page, before);
        }
        await page.setViewportSize({ width: 900, height: 412 });
        await expect(page.locator('.app')).toHaveClass(/comparison-compact/);
        await page.getByRole('button', { name: 'Fit', exact: true }).click();
        await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', 'fit');
        const before = await snapshot(page);
        await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
        await page.setViewportSize({ width: 900, height: 412 });
        await expect
          .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-scale')))
          .toBeCloseTo(Math.min((mode === 'Split Screen' ? 900 : 449.5) / 640, 412 / 480), 4);
        await unchanged(page, before);
        await page.screenshot({
          path: test
            .info()
            .outputPath(`${mode === 'Split Screen' ? 'split' : 'side'}-minimalist-landscape.png`),
        });
        await page.keyboard.press('Escape');
        await expect(
          page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
        ).toBeFocused();
      });
      test(`${mode}: real browser fullscreen uses the same view and system exit restores the interface`, async ({
        page,
        browserName,
      }) => {
        await page.addInitScript(() => {
          const win = window as any;
          const request = HTMLElement.prototype.requestFullscreen;
          win.actualFullscreenOutcome =
            typeof request === 'function' && typeof document.exitFullscreen === 'function'
              ? 'pending'
              : 'missing';
          if (win.actualFullscreenOutcome === 'missing') return;
          Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
            configurable: true,
            value: function (this: HTMLElement) {
              try {
                return Promise.resolve(request.call(this)).then(
                  () => {
                    win.actualFullscreenOutcome = 'granted';
                  },
                  (error) => {
                    win.actualFullscreenOutcome = 'denied';
                    throw error;
                  },
                );
              } catch (error) {
                win.actualFullscreenOutcome = 'denied';
                throw error;
              }
            },
          });
        });
        await open(page, mode);
        const before = await snapshot(page);
        await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
        await minimal(page, mode);
        await unchanged(page, before);
        await expect
          .poll(() => page.evaluate(() => (window as any).actualFullscreenOutcome))
          .not.toBe('pending');
        const outcome = await page.evaluate(() => (window as any).actualFullscreenOutcome);
        await test.info().attach('native-fullscreen-outcome', {
          body: JSON.stringify({ browserName, outcome }),
          contentType: 'application/json',
        });
        if (outcome === 'granted')
          await expect
            .poll(() =>
              page.evaluate(() => document.fullscreenElement === document.documentElement),
            )
            .toBe(true);
        if (await page.evaluate(() => Boolean(document.fullscreenElement)))
          await page.evaluate(() => document.exitFullscreen());
        else await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
        await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
        await expect(
          page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
        ).toBeFocused();
        await unchanged(page, before);
      });
      test(`${mode}: native touch pan/pinch and divider remain usable, rotation cancels contacts`, async ({
        page,
        browserName,
      }) => {
        test.skip(
          browserName !== 'chromium',
          'Native touch injection uses Chromium CDP; shared gesture regressions cover other engines.',
        );
        await installFullscreen(page, 'missing');
        await open(page, mode);
        await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
        const before = await snapshot(page);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: 60, y: 170, id: 1 }],
        });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: 90, y: 190, id: 1 }],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => (await snapshot(page)).x).not.toBe(before.x);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            { x: 60, y: 170, id: 1 },
            { x: 60, y: 270, id: 2 },
          ],
        });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: 60, y: 145, id: 1 },
            { x: 60, y: 295, id: 2 },
          ],
        });
        await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '3');
        await page.setViewportSize({ width: 900, height: 412 });
        await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
        const rotated = await snapshot(page);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: 60, y: 120, id: 1 },
            { x: 60, y: 320, id: 2 },
          ],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await unchanged(page, rotated);
        if (mode === 'Split Screen') {
          const slider = (await page.getByRole('slider').boundingBox())!;
          await page.mouse.move(slider.x + slider.width / 2, 180);
          await page.mouse.down();
          await page.mouse.move(slider.x + slider.width / 2 + 35, 180);
          await page.mouse.up();
          await expect(page.getByRole('slider')).not.toHaveAttribute(
            'aria-valuenow',
            before.divider!,
          );
        }
        await minimal(page, mode);
        await cdp.detach();
      });
    }
    test('a delayed success after explicit exit cannot reopen the view or capture later external fullscreen', async ({
      page,
    }) => {
      await installFullscreen(page, 'delayed');
      await open(page);
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await minimal(page);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
      ).toBeFocused();
      await page.evaluate(() => (window as any).completeFullscreen(0));
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as any).fullscreenCalls.filter((c: any) => c.method === 'exit').length,
          ),
        )
        .toBe(1);
      await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
      await page.evaluate(() => (window as any).externalFullscreen());
      expect(
        await page.evaluate(() => document.fullscreenElement === document.documentElement),
      ).toBe(true);
      await page.evaluate(() => (window as any).systemFullscreenExit());
    });
    test('a new active session survives completion of an older cancelled request', async ({
      page,
    }) => {
      await installFullscreen(page, 'delayed');
      await open(page);
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await page.evaluate(() => {
        (window as any).completeFullscreen(0);
        (window as any).completeFullscreen(1);
      });
      await minimal(page);
      await page.evaluate(() => (window as any).systemFullscreenExit());
      await expect(
        page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
      ).toBeFocused();
    });
    test('a new CSS session survives a previous native exit still in flight', async ({ page }) => {
      await installFullscreen(page, 'success');
      await open(page);
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await page.evaluate(() => {
        (window as any).deferFullscreenExit = true;
      });
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await page.evaluate(() => (window as any).completeFullscreenExit());
      await minimal(page);
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
      expect(
        await page.evaluate(
          () => (window as any).fullscreenCalls.filter((c: any) => c.method === 'request').length,
        ),
      ).toBe(1);
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
      ).toBeFocused();
    });
    test('partial API support uses CSS fallback without requesting an inescapable fullscreen', async ({
      page,
    }) => {
      await installFullscreen(page, 'request-only');
      await open(page);
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await minimal(page);
      expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
      ).toBeFocused();
    });
    test('a rejected exit leaves the UI usable and permits system exit', async ({ page }) => {
      await installFullscreen(page, 'success');
      await open(page);
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await page.evaluate(() => {
        (window as any).rejectFullscreenExit = true;
      });
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Enter fullscreen', exact: true }),
      ).toBeFocused();
      await page.evaluate(() => (window as any).systemFullscreenExit());
      await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    });
  });
}
