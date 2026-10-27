import { test, expect, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { imageFile } from '../e2e/fixtures';

async function openViewer(page: Page) {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('FSR.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
}

async function expectHandleFocus(page: Page, divider: Locator) {
  await expect(divider).toBeFocused();
  await expect(divider).toHaveJSProperty('tabIndex', 0);
  expect(await divider.evaluate((element) => element.matches(':focus-visible'))).toBe(true);

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
  await expect(handle).toHaveCSS('outline-style', 'solid');
  await expect(handle).toHaveCSS('outline-width', '2px');
  await expect(handle).toHaveCSS('outline-color', `rgb(${accent.join(', ')})`);
  const handleBounds = (await handle.boundingBox())!;
  expect(handleBounds.height).toBeLessThanOrEqual(44);
  expect(handleBounds.width).toBeLessThanOrEqual(44);
}

export function dividerFocusRegressionTests() {
  test('divider focus stays on the handle after keyboard shortcuts, fullscreen and mode changes', async ({
    page,
  }) => {
    await openViewer(page);
    const divider = page.getByRole('slider', { name: 'Comparison divider' });
    for (let round = 0; round < 2; round++) {
      // Preserve the mouse-then-keyboard sequence reported by desktop users.
      await divider.click();
      await page.keyboard.press('x');
      await expectHandleFocus(page, divider);
      await page.keyboard.press('2');
      await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
      await expectHandleFocus(page, divider);
      await page.keyboard.press('f');
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await expectHandleFocus(page, divider);
      await page.keyboard.press('f');
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
      await expectHandleFocus(page, divider);
      await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
      await expect(divider).toHaveCount(0);
      await page.getByRole('button', { name: 'Split Screen', exact: true }).click();
    }
  });

  test('divider remains reachable by Tab and adjustable with mouse and keyboard', async ({
    page,
  }) => {
    await openViewer(page);
    const stage = page.getByTestId('stage');
    const divider = page.getByRole('slider', { name: 'Comparison divider' });
    const bounds = (await stage.boundingBox())!;
    await page.mouse.click(bounds.x + 100, bounds.y + 120);
    await expect(stage).toBeFocused();
    await page.keyboard.press('Tab');
    await expectHandleFocus(page, divider);
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
      await expectHandleFocus(page, divider);
    }
    for (const fraction of [0.3, 0.7]) {
      const position = (await divider.boundingBox())!;
      const y = bounds.y + bounds.height * 0.4;
      await page.mouse.move(position.x + position.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * fraction, y, { steps: 8 });
      await page.mouse.up();
      await expect(divider).toHaveAttribute('aria-valuenow', String(fraction * 100));
      await page.keyboard.press('x');
      await expectHandleFocus(page, divider);
    }
  });
}
