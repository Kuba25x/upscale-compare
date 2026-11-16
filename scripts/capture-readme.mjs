// Capture actual unmodified demo UI with the repository's synthetic image fixtures.
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { imageFile } from '../tests/e2e/fixtures.ts';

execFileSync('npm', ['run', 'build:demo'], { stdio: 'inherit' });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--mode', 'demo',
  '--host', '127.0.0.1', '--port', '4180', '--strictPort'], { stdio: 'pipe' });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:4180/upscale-compare/')).ok) { ready = true; break; }
    } catch { /* Wait for the local preview server. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Demo preview did not start');
  browser = await chromium.launch({ headless: true });
  await mkdir('release-artifacts/screenshots', { recursive: true });
  for (const [name, viewport, mode, mobile] of [
    ['desktop-split.jpg', { width: 1280, height: 900 }, 'Split Screen', false],
    ['mobile-side-by-side.jpg', { width: 412, height: 915 }, 'Side-by-Side', true],
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.goto('http://127.0.0.1:4180/upscale-compare/');
    await page.getByTestId('file-input').setInputFiles([
      imageFile('Synthetic A.png', 0, 1280, 720), imageFile('Synthetic B.png', 1, 1280, 720),
    ]);
    await page.getByTestId('stage').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByLabel('Label for image A').fill('Synthetic A');
    await page.getByLabel('Label for image B').fill('Synthetic B');
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.evaluate(async () => {
      await Promise.all([...document.images].map((image) => image.decode()));
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const bytes = await page.screenshot({ type: 'jpeg', quality: 85, animations: 'disabled' });
    await writeFile('release-artifacts/screenshots/' + name, bytes);
    if (process.argv.includes('--emit-base64')) {
      const encoded = bytes.toString('base64');
      console.log('README_SCREENSHOT_BEGIN ' + name);
      for (let offset = 0; offset < encoded.length; offset += 4000) console.log('README_SCREENSHOT_DATA ' + encoded.slice(offset, offset + 4000));
      console.log('README_SCREENSHOT_END ' + name);
    }
    await page.close();
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
