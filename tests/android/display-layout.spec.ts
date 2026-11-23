import { test, expect, type Page } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { installAndroidBridge } from './bridge';
import { expectLocalComparisonUI } from '../shared/local-comparison';
import {
  chooseZoomPreset,
  expectPhonePortraitHeader,
  expectPhoneImageMenuKeyboard,
  expectPhoneZoomToolbar,
  expectLandscapeImagePopover,
  expectPortraitImagePanel,
  expectZoomMenuPlacement,
  helpDialog,
  manageImages,
  phoneZoomTrigger,
  phoneImageTrigger,
  imageChoices,
  zoomPresets,
  selectImage,
} from '../shared/phone-controls';
import {
  expectCenteredBrand,
  expectCenteredDividerArrows,
  expectSplitPosition,
  expectSplitRange,
} from '../shared/layout-alignment';

const files = [imageFile('A.png', 0), imageFile('B.png', 1), imageFile('C.png', 0)];

test('Android phone selects distinguish touch and keyboard focus through rotation', async ({
  page,
}) => {
  await open(page);
  await expectPhoneImageMenuKeyboard(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: 'Image controls' }).tap();
  await expectPhoneImageMenuKeyboard(page);
});

test('Android dismisses the anchored zoom menu with Back and when the toolbar is removed', async ({
  page,
}) => {
  await open(page);
  await phoneZoomTrigger(page).tap();
  await expectZoomMenuPlacement(page, { top: 32, bottom: 24, left: 8, right: 8 });
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(zoomPresets(page)).toBeHidden();
  await phoneZoomTrigger(page).tap();
  await expect(zoomPresets(page)).toBeVisible();
  await page
    .getByRole('button', { name: 'Enter fullscreen' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('.app')).toHaveClass(/comparison-minimalist/);
  await expect(zoomPresets(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit fullscreen' }).tap();
  await expect(phoneZoomTrigger(page)).toHaveAttribute('aria-expanded', 'false');
});

async function openLanding(page: Page) {
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
}
async function open(page: Page) {
  await openLanding(page);
  await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
  await expect(page.getByTestId('image-A')).toBeVisible();
}
async function insets(page: Page, values: Record<string, number | boolean>) {
  await page.evaluate((values) => {
    (window as any).displayInsets = values;
    (window as any).emitDisplayState();
  }, values);
}

test('landing centers the complete brand within Android safe padding through rotation', async ({
  page,
}) => {
  await openLanding(page);
  await page.setViewportSize({ width: 360, height: 820 });
  await insets(page, { cutoutTop: 48, cutoutLeft: 26, gestureRight: 16, navigationBottom: 24 });
  const header = page.locator('.app-header');
  await expect(header).toHaveCSS('padding-left', '26px');
  await expect(header).toHaveCSS('padding-right', '16px');
  await expectCenteredBrand(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await insets(page, { cutoutLeft: 46, gestureRight: 12 });
  await expect(page.locator('.app')).toHaveClass(/comparison-compact/);
  await expect(header).toHaveCSS('padding-left', '54px');
  await expect(header).toHaveCSS('padding-right', '20px');
  await expectCenteredBrand(page);
});

test('native measurements feed shared presentation and stale revisions cannot change it', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('.app')).toHaveClass(/comparison-edge-to-edge/);
  const state = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('.app')!;
    return {
      style: document.documentElement.getAttribute('style'),
      top: getComputedStyle(app).getPropertyValue('--comparison-safe-top'),
      bottom: getComputedStyle(app).getPropertyValue('--comparison-safe-bottom'),
    };
  });
  expect(state.top).toBe('32px');
  expect(state.bottom).toBe('24px');
  await page.evaluate(() => {
    const win = window as any;
    win['listener-layoutChange']({
      ...win.displayState,
      revision: -1,
      landscape: true,
      minimalist: true,
      safeTop: 900,
    });
  });
  await expect(page.locator('.app')).not.toHaveClass(/comparison-(compact|minimalist)/);
  await expect(page.locator('html')).toHaveAttribute('style', state.style!);
  await expect(page.locator('.app-header')).toBeVisible();
});

test('repeated native display failures remain visible after dismissing the previous error', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const cap = (window as any).Capacitor;
    const call = cap.nativePromise;
    cap.nativePromise = (plugin: string, method: string, args: unknown) => {
      if (plugin === 'DisplayLayout' && method === 'setMode')
        return Promise.reject(new Error('Test display failure'));
      return call(plugin, method, args);
    };
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect(page.getByRole('alert')).toHaveText('Could not change Android display mode.');
    await expect(page.locator('.app-header')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});
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

test('portrait phone controls respect cutouts and renamed originals survive WebView reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 820 });
  await open(page);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 820 });
    await insets(page, { cutoutTop: 48, cutoutLeft: 26, gestureRight: 16, navigationBottom: 24 });
    await expectPhonePortraitHeader(page, {
      icons: width === 320 ? false : width === 430 ? true : undefined,
    });
    await expectPhoneZoomToolbar(page, { left: 26, right: 16, oneRow: width !== 320 });
    await expectPortraitImagePanel(page, { left: 26, right: 16, bottom: 24, gap: 12 });
    const mode = await box(page, '.mode-controls');
    const actions = await box(page, '.header-actions');
    expect(mode.x).toBeGreaterThanOrEqual(26);
    expect(mode.y).toBeGreaterThanOrEqual(48);
    expect(actions.x + actions.width).toBeCloseTo(width - 16, 0);
  }
  await expect(page.locator('.image-selection-bar input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);

  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('test-session')!));
  const manage = manageImages(page);
  await page.getByRole('button', { name: 'Manage Images' }).click();
  await manage.getByRole('textbox', { name: 'Label for A.png' }).fill('Renamed A');
  await manage.getByRole('textbox', { name: 'Label for C.png' }).fill('Renamed unselected C');
  await manage.getByRole('button', { name: 'Help & About' }).click();
  await expect(helpDialog(page)).toBeVisible();
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(helpDialog(page)).toHaveCount(0);
  await expect(manage.getByRole('textbox', { name: 'Label for C.png' })).toHaveValue(
    'Renamed unselected C',
  );
  await manage.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'Renamed A');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('test-session')!)))
    .toEqual({
      ...before,
      images: [
        { ...before.images[0], label: 'Renamed A' },
        before.images[1],
        { ...before.images[2], label: 'Renamed unselected C' },
      ],
    });
  await page.reload();
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'Renamed A');
  await selectImage(page, 'A', 2);
  await expect(page.getByTestId('image-A')).toHaveAttribute('alt', 'Renamed unselected C');
});

test('large side insets allow complete button labels to wrap within the same row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await open(page);
  await insets(page, { cutoutLeft: 56, gestureRight: 48 });
  await expectPhonePortraitHeader(page, { icons: false, allowWrappedLabels: true });
  await expectPhoneZoomToolbar(page, { left: 56, right: 48, oneRow: false });
  await page.getByRole('button', { name: 'Manage Images' }).tap();
  await expect(manageImages(page).getByRole('textbox', { name: 'Label for A.png' })).toBeVisible();
});

test('portrait controls clear navigation, mandatory gestures and rounded display edges', async ({
  page,
}) => {
  await open(page);
  for (const navigationVisible of [false, true, false]) {
    await insets(page, {
      navigationBottom: 24,
      gestureBottom: navigationVisible ? 60 : 24,
      mandatoryGestureBottom: 32,
      navigationVisible,
    });
    await expectPortraitImagePanel(page, { bottom: 24, gap: 12 });
  }

  await insets(page, { navigationBottom: 48 });
  await expectPortraitImagePanel(page, { bottom: 48, gap: 12 });
  await insets(page, { navigationBottom: 24, mandatoryGestureBottom: 42 });
  await expectPortraitImagePanel(page, { bottom: 42, gap: 0 });

  await page.setViewportSize({ width: 320, height: 640 });
  await insets(page, { navigationBottom: 24, roundedBottom: 48, cutoutBottom: 30 });
  await expectPortraitImagePanel(page, { bottom: 48, gap: 12 });
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).tap();
  await expect(page.locator('.phone-image-controls')).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
  await expectPortraitImagePanel(page, { bottom: 48, gap: 12 });
});

test('Android tablet keeps the inline labels and keyboard button in both orientations', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(screen, 'width', { value: 800 });
    Object.defineProperty(screen, 'height', { value: 1280 });
  });
  await page.setViewportSize({ width: 800, height: 1280 });
  await open(page);
  await expect(page.getByLabel('Label for image A')).toBeVisible();
  await expect(page.getByRole('button', { name: '100%', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Zoom preset' })).toHaveCount(0);
  await expect(phoneZoomTrigger(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Image controls' }).click();
  await expect(page.getByLabel('Label for image A')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Zoom preset' })).toBeVisible();
  await expect(phoneZoomTrigger(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
});

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
  expect((await box(page, '.minimalist-exit')).y + 48).toBe(864);
  await page.setViewportSize({ width: 900, height: 412 });
  for (const side of ['cutoutLeft', 'cutoutRight']) {
    await insets(page, { [side]: 46, gestureLeft: 12, gestureRight: 12, gestureBottom: 18 });
    await assertBars(page, false, false);
    expect(await box(page, '.stage')).toMatchObject({ x: 0, y: 0, width: 900, height: 412 });
    const exit = await box(page, '.minimalist-exit');
    expect(exit.x + exit.width).toBe(900 - 12 - (side === 'cutoutRight' ? 46 : 12));
    expect(exit.y + exit.height).toBe(412 - 18 - 12);
    await expect(page.locator('button:visible')).toHaveCount(1);
    await expectSplitRange(page);
  }
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await assertBars(page, false, false);
  await expect(page.locator('.comparison-minimalist')).toHaveCount(0);
  expect((await box(page, '.app-header')).height).toBe(52);
  await expect(page.locator('.app-header .segmented button svg')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);
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
  await page.getByRole('slider').focus();
  await page.keyboard.press('Home');
  await expectCenteredDividerArrows(page);
  const clippedHandle = await box(page, '.divider-handle');
  const grip = stage.x + 6;
  const y = clippedHandle.y + clippedHandle.height / 2;
  await page.mouse.move(grip, y);
  await page.mouse.down();
  await expectSplitPosition(page, 0);
  await page.mouse.move(grip + 30, y);
  await page.mouse.up();
  await expectSplitPosition(page, (30 / (stage.width - 6)) * 100);
  await page.screenshot({ path: 'test-results/android/compact-landscape-right-cutout.png' });
  await page.setViewportSize({ width: 500, height: 240 });
  await insets(page, { cutoutLeft: 46, cutoutRight: 46, gestureBottom: 12 });
  await expectSplitRange(page);
  const logo = await box(page, '.app-header .brand-mark');
  expect(logo.x).toBeGreaterThanOrEqual(46);
  expect(
    (await box(page, '.header-actions')).x + (await box(page, '.header-actions')).width,
  ).toBeLessThanOrEqual(500 - 46);
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

test('compact image controls keep selection and swapping with labels in Manage Images', async ({
  page,
}) => {
  await open(page);
  await page.setViewportSize({ width: 900, height: 412 });
  await insets(page, { cutoutLeft: 46, gestureRight: 12, gestureBottom: 18 });
  const trigger = page.getByRole('button', { name: 'Image controls' });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expectLandscapeImagePopover(page, { left: 46, right: 12, bottom: 18 });
  await expectLocalComparisonUI(page);
  await expect(page.locator('.image-selection-bar input')).toHaveCount(0);
  await selectImage(page, 'A', 2);
  await expect.poll(async () => (await config(page)).selected).toEqual([2, 1]);
  await page.getByRole('button', { name: 'Swap images' }).click();
  await expect.poll(async () => (await config(page)).selected).toEqual([1, 2]);
  await phoneImageTrigger(page, 'B').tap();
  await expect(imageChoices(page, 'B')).toHaveCount(3);
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(imageChoices(page, 'B')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(page.locator('.image-selection-bar')).toBeHidden();
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  const dialog = await box(page, '.modal');
  expect(dialog.x).toBeGreaterThanOrEqual(46);
  expect(dialog.x + dialog.width).toBeLessThanOrEqual(900 - 12);
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage Images', exact: true }).click();
  const manage = manageImages(page);
  await expect(manage.getByRole('textbox')).toHaveCount(3);
  await expect(manage.locator('.upload-list img[src^="data:image/png;base64,"]')).toHaveCount(3);
  await manage.getByLabel('Label for C.png', { exact: true }).fill('Alternative C');
  await expect(page.getByTestId('image-B')).toHaveAttribute('alt', 'Alternative C');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => JSON.parse(localStorage.getItem('test-session')!))).images[2]
          .label,
    )
    .toBe('Alternative C');
  await page.evaluate(() => {
    (window as any).cancelPick = true;
  });
  await page.getByRole('button', { name: 'Replace all images' }).click();
  await expect.poll(async () => (await config(page)).selected).toEqual([1, 2]);
  await page.setViewportSize({ width: 500, height: 240 });
  const bounds = (await manage.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(46);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(500 - 12);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(240 - 18);
  await manage
    .getByRole('button', { name: /^Remove image / })
    .first()
    .tap();
  await expect(manage.getByRole('button', { name: /^Remove image / })).toHaveCount(2);
  await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
  await expect(manage).toHaveCount(0);
  await expect(page.getByTestId('stage')).toBeVisible();
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
    for (const zoom of [1, 2, 4, 6]) {
      await chooseZoomPreset(page, zoom);
      await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', String(zoom));
      await expect.poll(async () => (await config(page)).view.zoom).toBe(zoom);
      const centerBeforePan = (await config(page)).view.center;
      const stage = await box(page, '.stage');
      await page.mouse.move(stage.x + 150, stage.y + 100);
      await page.mouse.down();
      await page.mouse.move(stage.x + 170, stage.y + 120);
      await page.mouse.up();
      await expect.poll(async () => (await config(page)).view.center).not.toEqual(centerBeforePan);
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
    await expect.poll(async () => (await config(page)).view.zoom).toBeNull();
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
