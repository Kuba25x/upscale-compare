import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Rasterize the existing brand mark; no image-generation dependency or new artwork.
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const output = new URL('../assets/pwa/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  for (const [name, size, scale, opaque] of [
    ['icon-192.png', 192, 1, false],
    ['icon-512.png', 512, 1, false],
    ['icon-maskable-512.png', 512, 0.8, true],
    ['apple-touch-icon.png', 180, 1, true],
  ]) {
    const data = await page.evaluate(
      async ({ svg, size, scale, opaque }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        if (opaque) {
          context.fillStyle = '#101114';
          context.fillRect(0, 0, size, size);
        }
        const inset = (size * (1 - scale)) / 2;
        context.drawImage(image, inset, inset, size * scale, size * scale);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg, size, scale, opaque },
    );
    await writeFile(new URL(name, output), Buffer.from(data, 'base64'));
    console.log(`${name}: ${size}×${size}`);
  }
} finally {
  await browser.close();
}
