import { expect, test, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { open as openComparison, snapshot, unchanged } from '../shared/mobile-minimalist';
import { installWebDisplay } from '../shared/web-display';
import { installFullscreen, type FullscreenOutcome } from '../shared/web-fullscreen';

// Model the installed window and cutout inputs, not Android's OS window flags.
// Real Chromium/Firefox Fullscreen API behavior is tested separately below.
async function installedWindow(page: Page, finePointer = false) {
  await installWebDisplay(page, 'screen', finePointer, true);
  await page.addInitScript(() => {
    const win = window as any;
    win.testInstalled = true;
    const match = window.matchMedia.bind(window);
    const queries: MediaQueryList[] = [];
    window.matchMedia = (query: string) => {
      const result = match(query);
      if (query === '(display-mode: standalone)') {
        Object.defineProperty(result, 'matches', {
          get: () => win.testInstalled && !document.fullscreenElement,
        });
        queries.push(result);
      }
      return result;
    };
    win.changeInstallation = (installed: boolean) => {
      win.testInstalled = installed;
      queries.forEach((query) => query.dispatchEvent(new Event('change')));
    };
  });
}
async function mockApi(page: Page, outcome: FullscreenOutcome = 'success', enabled = true) {
  await installFullscreen(page, outcome);
  await page.addInitScript((enabled) => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: enabled });
  }, enabled);
}
async function launchLandscape(page: Page) {
  await page.setViewportSize({ width: 900, height: 412 });
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile('A.png'), imageFile('B.png', 1)]);
  await expect(page.getByRole('button', { name: 'Fullscreen options', exact: true })).toBeVisible();
}
async function options(page: Page) {
  await page.getByRole('button', { name: 'Fullscreen options', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fullscreen', exact: true })).toBeVisible();
}
async function enter(page: Page) {
  await options(page);
  await page.getByRole('button', { name: 'Fullscreen with controls', exact: true }).click();
}
async function rootFullscreen(page: Page) {
  return page.evaluate(() => document.fullscreenElement === document.documentElement);
}

test.beforeEach(async ({ page }, info) => {
  await installedWindow(page, info.title.includes('mouse-first'));
  await page.setViewportSize({ width: 412, height: 900 });
});

for (const mode of ['Split Screen', 'Side-by-Side'])
  test(`${mode}: full UI uses the available width and safe controls without changing source pixels or state`, async ({
    page,
  }) => {
    await mockApi(page);
    await openComparison(page, mode);
    await expect(page.getByRole('button', { name: 'Enter fullscreen', exact: true })).toBeVisible();
    const before = await snapshot(page);
    await page.setViewportSize({ width: 900, height: 412 });
    expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual([]);
    await enter(page);
    await expect.poll(() => rootFullscreen(page)).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    await unchanged(page, before);
    const call = await page.evaluate(() => (window as any).fullscreenCalls[0]);
    expect(call.options).toEqual({ navigationUI: 'hide' });
    expect(call.active).not.toBe(false);

    // Both cutout sides, without adding a blanket gutter to the image viewport.
    for (const [left, right] of [
      [46, 12],
      [12, 46],
    ]) {
      await page.addStyleTag({
        content: `.web-app { --comparison-safe-left:${left}px; --comparison-safe-right:${right}px; --comparison-safe-bottom:16px; }`,
      });
      await expect.poll(async () => (await page.getByTestId('stage').boundingBox())!.x).toBe(0);
      expect((await page.getByTestId('stage').boundingBox())!.width).toBe(900);
      for (const name of [
        'Manage Images',
        'Image controls',
        'Split Screen',
        'Side-by-Side',
        'Fit',
        'Zoom in',
        'Zoom out',
        'Comparison details',
        'Fullscreen options',
      ]) {
        const button = page.getByRole('button', { name, exact: true });
        await expect(button).toBeInViewport();
        const box = (await button.boundingBox())!;
        expect(box.x, name).toBeGreaterThanOrEqual(left);
        expect(box.x + box.width, name).toBeLessThanOrEqual(900 - right);
        expect(box.height, name).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);
      await options(page);
      const dialog = (await page.getByRole('dialog').boundingBox())!;
      expect(dialog.x).toBeGreaterThanOrEqual(left);
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(900 - right);
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Fullscreen options' })).toBeFocused();
    }
    await unchanged(page, before);
    await page.getByLabel('Zoom preset').selectOption('1');
    const dpr = await page.evaluate(() => devicePixelRatio);
    await expect
      .poll(async () => (await page.getByTestId('image-A').boundingBox())!.width * dpr)
      .toBeCloseTo(320, 1);
    await page.getByLabel('Zoom preset').selectOption('2');
    await unchanged(page, before);
    await options(page);
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect.poll(() => rootFullscreen(page)).toBe(false);
    await unchanged(page, before);
    await expect(page.getByRole('button', { name: 'Fullscreen options' })).toBeFocused();
  });

test('landscape launch never requests fullscreen; portrait exit and returning to landscape need another explicit tap', async ({
  page,
}) => {
  await mockApi(page);
  await launchLandscape(page);
  await expect(page.locator('.app-header')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual([]);
  await enter(page);
  await expect.poll(() => rootFullscreen(page)).toBe(true);
  // Opening the keyboard in landscape is not a portrait rotation.
  await page.setViewportSize({ width: 900, height: 240 });
  await expect(page.getByRole('button', { name: 'Fullscreen options' })).toBeVisible();
  expect(await rootFullscreen(page)).toBe(true);
  await page.setViewportSize({ width: 412, height: 900 });
  await expect.poll(() => rootFullscreen(page)).toBe(false);
  await expect(page.getByRole('button', { name: 'Fullscreen options' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enter fullscreen', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 412 });
  await expect(page.getByRole('button', { name: 'Fullscreen options' })).toBeVisible();
  expect(await rootFullscreen(page)).toBe(false);
  expect(
    await page.evaluate(
      () => (window as any).fullscreenCalls.filter((c: any) => c.method === 'request').length,
    ),
  ).toBe(1);
});

for (const outcome of ['reject', 'throw', 'missing', 'request-only', 'disabled'] as const)
  test(`API ${outcome} leaves the full UI usable and retains minimalist fallback`, async ({
    page,
  }) => {
    await mockApi(page, outcome === 'disabled' ? 'reject' : outcome, outcome !== 'disabled');
    await launchLandscape(page);
    await options(page);
    const full = page.getByRole('button', { name: 'Fullscreen with controls', exact: true });
    if (outcome === 'reject' || outcome === 'throw') {
      await full.click();
      await expect(page.getByRole('status')).toContainText('Fullscreen is unavailable');
    } else await expect(full).toBeDisabled();
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    expect(await rootFullscreen(page)).toBe(false);
    await page.getByRole('button', { name: 'Minimalist mode', exact: true }).click();
    await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
    await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fullscreen options' })).toBeFocused();
  });

test('Escape closes fullscreen options before the image panel behind it', async ({ page }) => {
  await mockApi(page);
  await launchLandscape(page);
  const images = page.getByRole('button', { name: 'Image controls', exact: true });
  await images.click();
  await options(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(images).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Fullscreen options' })).toBeFocused();
  expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual([]);
});

test('portrait cancels a delayed request and closes fullscreen if it arrives late', async ({
  page,
}) => {
  await mockApi(page, 'delayed');
  await launchLandscape(page);
  await enter(page);
  await expect(page.getByRole('button', { name: 'Cancel fullscreen request' })).toBeVisible();
  await page.setViewportSize({ width: 412, height: 900 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => (window as any).completeFullscreen(0));
  await expect.poll(() => rootFullscreen(page)).toBe(false);
  await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
  await expect(page.locator('.app-header')).toBeVisible();
});

test('minimalist mode adopts the pending session without a second request and still survives portrait rotation', async ({
  page,
}) => {
  await mockApi(page, 'delayed');
  await launchLandscape(page);
  await enter(page);
  await page.getByRole('button', { name: 'Minimalist mode', exact: true }).click();
  await page.evaluate(() => (window as any).completeFullscreen(0));
  await expect.poll(() => rootFullscreen(page)).toBe(true);
  await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
  await page.setViewportSize({ width: 412, height: 900 });
  await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
  expect(await rootFullscreen(page)).toBe(true);
  expect(
    await page.evaluate(
      () => (window as any).fullscreenCalls.filter((c: any) => c.method === 'request').length,
    ),
  ).toBe(1);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => rootFullscreen(page)).toBe(false);
});

test('system exit leaves all controls usable and does not re-enter fullscreen', async ({
  page,
}) => {
  await mockApi(page);
  await launchLandscape(page);
  await enter(page);
  await expect.poll(() => rootFullscreen(page)).toBe(true);
  await page.evaluate(() => (window as any).systemFullscreenExit());
  await expect.poll(() => rootFullscreen(page)).toBe(false);
  await expect(page.locator('.app-header')).toBeVisible();
  await options(page);
  await expect(page.getByRole('button', { name: 'Fullscreen with controls' })).toBeEnabled();
});

test('rejected exit retains a reachable exit action and accepts the system exit', async ({
  page,
}) => {
  await mockApi(page);
  await launchLandscape(page);
  await enter(page);
  await expect.poll(() => rootFullscreen(page)).toBe(true);
  await page.evaluate(() => {
    (window as any).rejectFullscreenExit = true;
  });
  await options(page);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await options(page);
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('system fullscreen exit control');
  await page.evaluate(() => (window as any).systemFullscreenExit());
  await expect.poll(() => rootFullscreen(page)).toBe(false);
});

test('mouse-first installed desktop retains the original full-UI fullscreen action', async ({
  page,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 900, height: 412 });
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile('A.png'), imageFile('B.png', 1)]);
  await expect(page.getByRole('button', { name: 'Fullscreen options' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect.poll(() => rootFullscreen(page)).toBe(true);
  await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
  await expect(page.locator('.app-header')).toBeVisible();
});

test('touch pan and pinch retain physical-pixel scaling with full controls', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Multicontact input uses Chromium CDP; other engines retain their existing gesture regressions.',
  );
  await mockApi(page);
  await openComparison(page);
  await page.setViewportSize({ width: 900, height: 412 });
  await enter(page);
  await expect.poll(() => rootFullscreen(page)).toBe(true);
  const before = await snapshot(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const point = (id: number, x: number) => ({ id, x, y: 180 });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, 300)],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, 340)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => Math.abs((await snapshot(page)).x - before.x))
      .toBeGreaterThan(10);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, 300), point(2, 500)],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(1, 250), point(2, 550)],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-zoom')))
      .toBeGreaterThan(2);
    const dpr = await page.evaluate(() => devicePixelRatio);
    const zoom = Number(await page.getByTestId('stage').getAttribute('data-zoom'));
    await expect
      .poll(async () => (await page.getByTestId('image-A').boundingBox())!.width * dpr)
      .toBeCloseTo(320 * zoom, 1);
    expect(await page.evaluate(() => (window as any).imageLoads)).toBe(0);
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
  } finally {
    await cdp.detach();
  }
});

test('a regular browser tab keeps the original fullscreen/minimalist control', async ({ page }) => {
  await mockApi(page);
  await launchLandscape(page);
  await page.evaluate(() => (window as any).changeInstallation(false));
  await expect(page.getByRole('button', { name: 'Fullscreen options' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
  await expect.poll(() => rootFullscreen(page)).toBe(true);
  await expect(page.getByRole('button', { name: 'Fullscreen options' })).toHaveCount(0);
});

test('the real browser API keeps the full interface and handles denial explicitly', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Physical Android targets are Chromium and Firefox; other engines have API fallback coverage.',
  );
  await launchLandscape(page);
  await options(page);
  const full = page.getByRole('button', { name: 'Fullscreen with controls' });
  test.skip(
    await full.isDisabled(),
    'The engine does not expose an enabled, escapable Fullscreen API.',
  );
  await full.click();
  await expect
    .poll(async () => (await rootFullscreen(page)) || (await page.getByRole('status').count()) > 0)
    .toBe(true);
  if (await rootFullscreen(page)) {
    test.info().annotations.push({ type: 'native-fullscreen', description: 'granted' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    await expect(page.getByRole('button', { name: 'Manage Images', exact: true })).toBeVisible();
    await expect(page.getByTestId('stage')).toBeVisible();
    await options(page);
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect.poll(() => rootFullscreen(page)).toBe(false);
  } else {
    test
      .info()
      .annotations.push({ type: 'native-fullscreen', description: 'denied; normal UI retained' });
    await expect(page.getByRole('status')).toContainText('Fullscreen is unavailable');
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
  }
});
