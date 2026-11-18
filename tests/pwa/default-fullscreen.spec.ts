import { expect, test, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { open as openComparison, snapshot, unchanged } from '../shared/mobile-minimalist';
import { installWebDisplay } from '../shared/web-display';
import { installFullscreen, type FullscreenOutcome } from '../shared/web-fullscreen';
import { cacheSnapshot, control, serve } from './helpers';

test.beforeEach(async ({ request }) => {
  // Other PWA suites deliberately leave the shared server on a faulty B release.
  await serve(request);
});

// Explicit browser-window model: no assertion here claims Android OS cutout policy.
async function windowMode(
  page: Page,
  initial: 'fullscreen' | 'browser',
  fine = false,
  outcome: FullscreenOutcome = 'success',
) {
  await installWebDisplay(page, 'screen', fine, true);
  await page.addInitScript((initial) => {
    const win = window as any;
    win.nativeWindowMode = initial;
    const queries: MediaQueryList[] = [];
    const match = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const result = match(query);
      if (query.startsWith('(display-mode:')) {
        Object.defineProperty(result, 'matches', {
          get: () =>
            query ===
            `(display-mode: ${document.fullscreenElement ? 'fullscreen' : win.nativeWindowMode})`,
        });
        queries.push(result);
      }
      return result;
    };
    win.changeWindowMode = (mode: string) => {
      win.nativeWindowMode = mode;
      queries.forEach((query) => query.dispatchEvent(new Event('change')));
    };
  }, initial);
  await installFullscreen(page, outcome);
}

async function insets(page: Page, top: number, right: number, bottom: number, left: number) {
  await page.addStyleTag({
    content: `.web-app.installed-fullscreen {
    --comparison-safe-top:${top}px; --comparison-safe-right:${right}px;
    --comparison-safe-bottom:${bottom}px; --comparison-safe-left:${left}px;
  }`,
  });
}

async function safe(
  page: Page,
  selector: ReturnType<Page['locator']>,
  bounds: { top: number; right: number; bottom: number; left: number },
) {
  await selector.scrollIntoViewIfNeeded();
  await expect(selector).toBeInViewport();
  const box = (await selector.boundingBox())!;
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.x).toBeGreaterThanOrEqual(bounds.left);
  expect(box.y).toBeGreaterThanOrEqual(bounds.top);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - bounds.right);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - bounds.bottom);
}

for (const sample of [
  { name: 'portrait top cutout', width: 412, height: 900, top: 56, right: 0, bottom: 28, left: 0 },
  {
    name: 'portrait asymmetric sides',
    width: 390,
    height: 844,
    top: 48,
    right: 0,
    bottom: 24,
    left: 18,
  },
  {
    name: 'landscape left cutout',
    width: 900,
    height: 412,
    top: 12,
    right: 0,
    bottom: 24,
    left: 56,
  },
  {
    name: 'landscape right cutout',
    width: 900,
    height: 412,
    top: 12,
    right: 56,
    bottom: 24,
    left: 0,
  },
])
  test(`${sample.name}: default fullscreen retains safe title, import, controls and dialogs`, async ({
    page,
  }) => {
    await windowMode(page, 'fullscreen');
    await page.setViewportSize({ width: sample.width, height: sample.height });
    await page.goto('./?pwa=fullscreen');
    await expect(page.locator('.app')).toHaveClass(/installed-fullscreen/);
    await insets(page, sample.top, sample.right, sample.bottom, sample.left);
    await safe(page, page.getByRole('heading', { name: 'Upscale Compare', exact: true }), sample);
    await safe(page, page.locator('.brand-mark'), sample);
    await safe(page, page.getByRole('button', { name: 'Upload Images', exact: true }), sample);
    await safe(page, page.locator('.landing-footer button'), sample);
    expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual([]);
    await page.getByTestId('file-input').setInputFiles([imageFile('A.png'), imageFile('B.png', 1)]);
    await expect(page.getByTestId('stage')).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    await expect(page.getByRole('button', { name: 'Enter fullscreen', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Fullscreen options', exact: true })).toHaveCount(
      0,
    );
    await safe(page, page.getByRole('heading', { name: 'Upscale Compare', exact: true }), sample);
    for (const name of [
      'Split Screen',
      'Side-by-Side',
      'Upload Images',
      'Fit',
      'Zoom out',
      'Zoom in',
      'Comparison details',
      'Keyboard shortcuts',
      'Minimalist mode',
    ])
      await safe(page, page.getByRole('button', { name, exact: true }), sample);
    if (sample.width > sample.height) {
      expect((await page.getByTestId('stage').boundingBox())!.x).toBe(0);
      expect((await page.getByTestId('stage').boundingBox())!.width).toBe(sample.width);
      await page.getByRole('button', { name: 'Image controls', exact: true }).click();
    }
    for (const name of [
      'Select image A',
      'Select image B',
      'Label for image A',
      'Label for image B',
    ])
      await safe(page, page.getByLabel(name, { exact: true }), sample);
    if (sample.width > sample.height)
      await page.getByRole('button', { name: 'Image controls', exact: true }).click();
    const slider = page.getByRole('slider');
    await slider.focus();
    for (const key of ['Home', 'End']) {
      await page.keyboard.press(key);
      await safe(page, page.locator('.divider-handle'), sample);
    }
    await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
    await safe(page, page.getByRole('dialog'), sample);
    await page.getByLabel('Game title').fill('Safe installed fullscreen');
    await page.getByRole('button', { name: 'Save details', exact: true }).click();
    // The standard upload dialog and picker cancellation retain the comparison.
    await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
    await safe(page, page.getByRole('dialog'), sample);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByTestId('stage')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`${sample.name}.png`) });
  });

for (const mode of ['Split Screen', 'Side-by-Side'])
  test(`${mode}: minimalist is independent of manifest fullscreen across rotations and system Back`, async ({
    page,
  }) => {
    await windowMode(page, 'fullscreen');
    await page.setViewportSize({ width: 412, height: 900 });
    await openComparison(page, mode, './?pwa=fullscreen');
    const before = await snapshot(page);
    await insets(page, 56, 0, 28, 0);
    await page.getByRole('button', { name: 'Minimalist mode', exact: true }).click();
    await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
    await unchanged(page, before);
    await safe(page, page.getByRole('button', { name: 'Show controls', exact: true }), {
      top: 56,
      right: 0,
      bottom: 28,
      left: 0,
    });
    await page.setViewportSize({ width: 900, height: 412 });
    await insets(page, 12, 0, 24, 56);
    await unchanged(page, before);
    await safe(page, page.getByRole('button', { name: 'Show controls', exact: true }), {
      top: 12,
      right: 0,
      bottom: 24,
      left: 56,
    });
    await page.getByRole('button', { name: 'Show controls', exact: true }).click();
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    expect(await page.evaluate(() => matchMedia('(display-mode: fullscreen)').matches)).toBe(true);
    await unchanged(page, before);
    await page.getByRole('button', { name: 'Minimalist mode', exact: true }).click();
    await page.evaluate(() => (window as any).systemFullscreenExit());
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    await expect(page.getByRole('button', { name: 'Minimalist mode', exact: true })).toBeVisible();
    await unchanged(page, before);
  });

test('manifest fullscreen works with CSS minimalist fallback when the Fullscreen API is unavailable', async ({
  page,
}) => {
  await windowMode(page, 'fullscreen', false, 'missing');
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto('./?pwa=fullscreen');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
  await page.getByRole('button', { name: 'Minimalist mode', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
  expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual([]);
});

test('keyboard and dialogs stay within the reported visual and safe viewport', async ({ page }) => {
  await windowMode(page, 'fullscreen');
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto('./?pwa=fullscreen');
  await insets(page, 56, 0, 28, 0);
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await page.getByLabel('Game title').focus();
  await page.evaluate(() => {
    (window as any).testVisualViewport = { height: 300, width: 412, offsetTop: 0 };
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(async () => (await page.getByRole('dialog').boundingBox())!.y)
    .toBeGreaterThanOrEqual(56);
  // visualViewport changes are batched through requestAnimationFrame. The old
  // dialog already satisfies the top bound; wait for the bottom bound as well.
  await expect
    .poll(async () => {
      const box = (await page.getByRole('dialog').boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(300 - 28);
  const box = (await page.getByRole('dialog').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(56);
  await expect(page.locator('.app')).toHaveClass(/installed-fullscreen/);
  await expect(page.locator('.app')).not.toHaveClass(/comparison-compact/);
});

test('the marked launch URL reopens offline without persisting local images or metadata', async ({
  page,
  context,
}) => {
  await windowMode(page, 'fullscreen');
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto('./?pwa=fullscreen');
  await control(page);
  await page
    .getByTestId('file-input')
    .setInputFiles([imageFile('Private.png'), imageFile('B.png', 1)]);
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await page.getByLabel('Game title').fill('Private metadata must not survive');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.app')).toHaveClass(/installed-fullscreen/);
  await expect(page.getByTestId('stage')).toHaveCount(0);
  await page
    .getByTestId('file-input')
    .setInputFiles([imageFile('Fresh.png'), imageFile('Fresh B.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await expect(page.getByLabel('Game title')).toHaveValue('');
  expect(JSON.stringify(await cacheSnapshot(page))).not.toMatch(
    /Private\.png|Fresh\.png|Private metadata|blob:|pwa=fullscreen/,
  );
});

for (const marked of [false, true])
  test(`a normal browser tab ${marked ? 'with' : 'without'} the launch hint never becomes installed through API fullscreen or F11`, async ({
    page,
  }) => {
    await windowMode(page, 'browser');
    await page.setViewportSize({ width: 412, height: 900 });
    await page.goto(marked ? './?pwa=fullscreen' : './');
    await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
    await expect(page.locator('.app')).not.toHaveClass(/installed-fullscreen/);
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
    await expect(page.locator('.app')).not.toHaveClass(/installed-fullscreen/);
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await page.evaluate(() => (window as any).changeWindowMode('fullscreen'));
    await expect(page.locator('.app')).not.toHaveClass(/installed-fullscreen/);
    await expect(page.getByRole('button', { name: 'Enter fullscreen', exact: true })).toBeVisible();
  });

test('a desktop installed window that honors manifest fullscreen keeps full controls and independent minimalist mode', async ({
  page,
}) => {
  await windowMode(page, 'fullscreen', true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./?pwa=fullscreen');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
  await expect(page.locator('.app')).toHaveClass(/installed-fullscreen/);
  await expect(page.locator('.app')).not.toHaveClass(/comparison-compact/);
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Minimalist mode', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(await page.evaluate(() => matchMedia('(display-mode: fullscreen)').matches)).toBe(true);
});

test('a canonical website opened while F11 fullscreen is already active keeps the tab UI', async ({
  page,
}) => {
  await windowMode(page, 'fullscreen', true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
  await expect(page.locator('.app')).not.toHaveClass(/installed-fullscreen/);
  await expect(page.getByRole('button', { name: 'Enter fullscreen', exact: true })).toBeVisible();
});
