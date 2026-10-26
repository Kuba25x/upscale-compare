import { PNG } from 'pngjs';
import { expect, type Page } from '@playwright/test';
export function imageFile(name = 'DLSS Quality.png', variant = 0, width = 640, height = 480) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = variant ? 180 : x % 256;
      png.data[i + 1] = y % 256;
      png.data[i + 2] = variant ? x % 256 : 80;
      png.data[i + 3] = 255;
    }
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(png) };
}
export async function openComparison(page: Page, count = 2) {
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles(
      Array.from({ length: count }, (_, index) =>
        imageFile(
          ['DLSS Quality.png', 'FSR Quality.png', 'Native.png', 'XeSS.png'][index],
          index % 2,
        ),
      ),
    );
  await expect(page.getByTestId('stage')).toBeVisible();
}
