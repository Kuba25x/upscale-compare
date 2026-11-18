import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageFile } from '../e2e/fixtures';
import { control, originalBytes, serve } from './helpers';

test('a full browser/profile restart starts offline with an empty local session', async ({
  request,
  baseURL,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'Disk-profile restart is exercised in Chromium; other engines have app-window lifecycle coverage.',
  );
  await serve(request);
  const directory = await mkdtemp(join(tmpdir(), 'upscale-offline-profile-'));
  const options = {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
    headless: true,
    viewport: testInfo.project.use.viewport,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  };
  let browser: BrowserContext | undefined;
  try {
    browser = await chromium.launchPersistentContext(directory, options);
    const first = browser.pages()[0];
    await first.goto(baseURL!);
    await control(first);
    const session = await browser.newCDPSession(first);
    expect((await session.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
    const { data, url, errors } = await session.send('Page.getAppManifest');
    expect(errors).toEqual([]);
    expect(url).toBe(new URL('manifest.webmanifest', baseURL).href);
    const manifest = JSON.parse(data!);
    expect(manifest.name).toBe('Upscale Compare');
    expect(manifest.display).toBe('standalone');
    for (const key of ['id', 'scope', 'start_url'])
      expect(manifest[key]).toBe(new URL(baseURL!).pathname);
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
      '192x192',
      '512x512',
      '512x512',
    ]);
    await session.detach();
    const file = imageFile('Do not restore this name.png');
    await first.getByTestId('file-input').setInputFiles([file, imageFile('B.png', 1)]);
    await first.getByLabel('Label for image A').fill('Do not restore this label');
    await first.getByRole('button', { name: 'Comparison details', exact: true }).click();
    await first.getByLabel('Game title').fill('Do not restore metadata');
    await first.getByRole('button', { name: 'Save details', exact: true }).click();
    await browser.close();
    browser = await chromium.launchPersistentContext(directory, { ...options, offline: true });
    const second = browser.pages()[0];
    await second.goto(baseURL!);
    await expect(second.getByTestId('stage')).toHaveCount(0);
    await second.getByTestId('file-input').setInputFiles([file, imageFile('New B.png', 1)]);
    await expect(second.getByTestId('stage')).toBeVisible();
    expect(await originalBytes(second)).toEqual(Array.from(file.buffer));
    await expect(second.getByLabel('Label for image A')).toHaveValue('Do not restore this name');
    await second.getByRole('button', { name: 'Comparison details', exact: true }).click();
    await expect(second.getByLabel('Game title')).toHaveValue('');
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
