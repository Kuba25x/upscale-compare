import { test, expect } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { installFullscreen } from './web-fullscreen';

export function desktopFullscreenTests() {
  test('desktop fullscreen retains the interface and rejected requests still show help', async ({
    page,
  }) => {
    await installFullscreen(page, 'success');
    await page.goto('./');
    await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.image-selection-bar')).toBeVisible();
    await expect(page.locator('.inspection-toolbar')).toBeVisible();
    await expect(page.locator('.minimalist-exit')).toHaveCount(0);
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await page.evaluate(() =>
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
        value: () => Promise.reject(new Error('Test desktop fullscreen denial')),
      }),
    );
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.app')).not.toHaveClass(/comparison-minimalist/);
  });
}
