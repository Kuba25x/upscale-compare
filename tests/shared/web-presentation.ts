import { test, expect } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';

export function webPresentationTests() {
  test('uploads on the web without initializing Capacitor or enabling native presentation', async ({
    page,
    isMobile,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'Capacitor', {
        get() {
          throw new Error('The web must not initialize Capacitor');
        },
        set() {
          throw new Error('The web must not install Capacitor');
        },
      });
    });
    await page.goto('./');
    await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
    await expect(page.getByTestId('stage')).toBeVisible();
    await page.evaluate(() => {
      (window as any).presentationLayers = [...document.querySelectorAll('.comparison-image')];
    });
    for (const viewport of [
      { width: 412, height: 900 },
      { width: 900, height: 412 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.app')).not.toHaveClass(/android-app|comparison-minimalist/);
      // Resize is measured on an animation frame; wait for the expected new layout.
      const compact = isMobile && viewport.width > viewport.height;
      if (compact) {
        await expect(page.locator('.app')).toHaveClass(/comparison-compact/);
        await expect(page.locator('.image-selection-bar')).toBeHidden();
        await expect(page.getByLabel('Zoom preset')).toBeVisible();
      } else {
        await expect(page.locator('.app')).not.toHaveClass(/comparison-compact/);
        await expect(page.locator('.image-selection-bar')).toBeVisible();
        await expect(page.getByRole('button', { name: '100%', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Image controls' })).toHaveCount(0);
        await expect(page.getByLabel('Zoom preset')).toHaveCount(0);
      }
      await expect(page.locator('.minimalist-exit')).toHaveCount(0);
    }
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('.comparison-image')].every(
          (node, i) => node === (window as any).presentationLayers[i],
        ),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
