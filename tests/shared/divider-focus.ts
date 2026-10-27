import { test, expect, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { imageFile } from '../e2e/fixtures';

async function openViewer(page: Page) {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
}

async function expectDividerFocus(page: Page, divider: Locator, origin: 'keyboard' | 'pointer') {
  const keyboardFocus = origin === 'keyboard';
  if (keyboardFocus) await expect(divider).toBeFocused();
  else {
    await expect(divider).not.toBeFocused();
    await expect(page.getByTestId('stage')).toBeFocused();
  }
  await expect(divider).toHaveJSProperty('tabIndex', 0);
  const focusVisible = await divider.evaluate((element) => element.matches(':focus-visible'));
  expect(focusVisible).toBe(keyboardFocus);

  // Sample above the handle: the old full-height outline painted accent pixels here.
  const bounds = (await divider.boundingBox())!;
  const strip = PNG.sync.read(
    await page.screenshot({
      clip: {
        x: Math.floor(bounds.x) - 6,
        y: Math.floor(bounds.y + bounds.height * 0.22),
        width: Math.ceil(bounds.width) + 12,
        height: 8,
      },
    }),
  );
  const accent = await divider.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    element.append(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
    probe.remove();
    return rgb;
  });
  let accentPixels = 0;
  for (let index = 0; index < strip.data.length; index += 4)
    if (accent.every((channel, offset) => strip.data[index + offset] === channel)) accentPixels++;
  expect(accentPixels, 'Keyboard focus must not paint full-height accent lines').toBe(0);

  await expect(divider).toHaveCSS('outline-style', 'none');
  const handle = divider.locator('.divider-handle');
  if (!keyboardFocus) {
    await expect(handle).toHaveCSS('outline-style', 'none');
    return;
  }
  await expect(handle).toHaveCSS('outline-style', 'solid');
  await expect(handle).toHaveCSS('outline-width', '2px');
  await expect(handle).toHaveCSS('outline-color', `rgb(${accent.join(', ')})`);
  const handleBounds = (await handle.boundingBox())!;
  expect(handleBounds.height).toBeLessThanOrEqual(44);
  expect(handleBounds.width).toBeLessThanOrEqual(44);
}

async function dragDivider(page: Page, divider: Locator, fraction: number) {
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const position = (await divider.boundingBox())!;
  const y = stage.y + stage.height * 0.4;
  const before = await page.getByTestId('image-A').boundingBox();
  await page.mouse.move(position.x + position.width / 2, y);
  await page.mouse.down();
  await expect(divider).not.toBeFocused();
  await expect(page.getByTestId('stage')).toBeFocused();
  await expect(divider.locator('.divider-handle')).toHaveCSS('outline-style', 'none');
  await page.mouse.move(stage.x + stage.width * fraction, y, { steps: 8 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  expect(await page.getByTestId('image-A').boundingBox()).toEqual(before);
}

export function dividerFocusRegressionTests() {
  test('mouse clicks and drags never focus the divider after shortcuts or mode changes', async ({
    page,
  }) => {
    await openViewer(page);
    const divider = page.getByRole('slider', { name: 'Comparison divider' });
    for (let round = 0; round < 2; round++) {
      // Moving focus out of an input must also restore global shortcuts.
      await page.getByLabel('Label for image A').fill(`Custom label ${round}`);
      await divider.click();
      await expectDividerFocus(page, divider, 'pointer');
      await page.keyboard.press('q');
      await expectDividerFocus(page, divider, 'pointer');
      await dragDivider(page, divider, round ? 0.7 : 0.3);
      await expectDividerFocus(page, divider, 'pointer');
      for (const key of ['q', '2', 'x', '+', '-', '1']) {
        await page.keyboard.press(key);
        if (key === '2') await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
        await expectDividerFocus(page, divider, 'pointer');
      }
      for (const fullscreen of [true, false]) {
        await page.keyboard.press('f');
        await expect
          .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
          .toBe(fullscreen);
        await expectDividerFocus(page, divider, 'pointer');
      }
      await page.keyboard.press('v');
      await expect(divider).toHaveCount(0);
      await page.keyboard.press('s');
      await expectDividerFocus(page, divider, 'pointer');
    }
  });

  test('Tab and Shift+Tab reveal divider focus and preserve keyboard controls and shortcuts', async ({
    page,
  }) => {
    await openViewer(page);
    const stage = page.getByTestId('stage');
    const divider = page.getByRole('slider', { name: 'Comparison divider' });
    const bounds = (await stage.boundingBox())!;
    await page.mouse.click(bounds.x + 100, bounds.y + 120);
    await expect(stage).toBeFocused();
    await page.keyboard.press('Tab');
    await expectDividerFocus(page, divider, 'keyboard');
    const before = await page.getByTestId('image-A').boundingBox();
    for (const [key, value] of [
      ['Home', '0'],
      ['ArrowRight', '1'],
      ['Shift+ArrowRight', '11'],
      ['ArrowLeft', '10'],
      ['End', '100'],
      ['Shift+ArrowLeft', '90'],
    ]) {
      await page.keyboard.press(key);
      await expect(divider).toHaveAttribute('aria-valuenow', value);
      await expectDividerFocus(page, divider, 'keyboard');
      expect(await page.getByTestId('image-A').boundingBox()).toEqual(before);
    }
    await page.keyboard.press('Tab');
    await expect(divider).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expectDividerFocus(page, divider, 'keyboard');
    await page.keyboard.press('2');
    await expect(stage).toHaveAttribute('data-zoom', '2');
    await expectDividerFocus(page, divider, 'keyboard');
    for (const fullscreen of [true, false]) {
      await page.keyboard.press('f');
      await expect
        .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
        .toBe(fullscreen);
      await expectDividerFocus(page, divider, 'keyboard');
    }
  });

  test('repeated keyboard-to-mouse transitions release slider focus until Tab re-entry', async ({
    page,
  }) => {
    await openViewer(page);
    const stage = page.getByTestId('stage');
    const divider = page.getByRole('slider', { name: 'Comparison divider' });
    const bounds = (await stage.boundingBox())!;
    await page.mouse.click(bounds.x + 100, bounds.y + 120);
    for (const fraction of [0.3, 0.7]) {
      await page.keyboard.press('Tab');
      await expectDividerFocus(page, divider, 'keyboard');
      await page.keyboard.press('Home');
      await dragDivider(page, divider, fraction);
      await expectDividerFocus(page, divider, 'pointer');
      const beforeA = (await page.getByTestId('image-A').boundingBox())!;
      const beforeB = (await page.getByTestId('image-B').boundingBox())!;
      // With viewer focus, arrows pan images instead of adjusting an unfocused slider.
      await page.keyboard.press('ArrowRight');
      await expect(divider).toHaveAttribute('aria-valuenow', String(fraction * 100));
      expect((await page.getByTestId('image-A').boundingBox())!.x).toBeCloseTo(beforeA.x - 50, 3);
      expect((await page.getByTestId('image-B').boundingBox())!.x).toBeCloseTo(beforeB.x - 50, 3);
      await expectDividerFocus(page, divider, 'pointer');
      await page.keyboard.press('Tab');
      await expectDividerFocus(page, divider, 'keyboard');
      await page.keyboard.press('ArrowRight');
      await expect(divider).toHaveAttribute('aria-valuenow', String(fraction * 100 + 1));
      await divider.click();
      await page.keyboard.press('q');
      await expectDividerFocus(page, divider, 'pointer');
    }
  });
}
