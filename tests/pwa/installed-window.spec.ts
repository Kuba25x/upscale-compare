import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageFile } from '../e2e/fixtures';
import { control, originalBytes, serve } from './helpers';

test('installed Linux Chromium window uses the existing UI and reopens standalone offline', async ({
  request,
  baseURL,
}, testInfo) => {
  await serve(request);
  const directory = await mkdtemp(join(tmpdir(), 'upscale-installed-pwa-'));
  const options = {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: false,
    args: ['--no-sandbox'],
    env: {
      ...process.env,
      XDG_DATA_HOME: join(directory, 'data'),
      XDG_CONFIG_HOME: join(directory, 'config'),
      XDG_CACHE_HOME: join(directory, 'cache'),
    },
  };
  let browser: BrowserContext | undefined;
  async function launch(context: BrowserContext): Promise<Page> {
    const session = await context.newCDPSession(context.pages()[0]);
    const window = context.waitForEvent('page');
    await session.send('PWA.launch', { manifestId: baseURL! });
    const app = await window;
    await app.waitForLoadState();
    await expect
      .poll(() => app.evaluate(() => matchMedia('(display-mode: standalone)').matches))
      .toBe(true);
    await session.detach();
    return app;
  }
  try {
    browser = await chromium.launchPersistentContext(join(directory, 'profile'), options);
    const tab = browser.pages()[0];
    await tab.goto(baseURL!);
    await control(tab);
    const session = await browser.newCDPSession(tab);
    expect((await session.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
    await session.send('PWA.install', { manifestId: baseURL!, installUrlOrBundleUrl: baseURL! });
    // CDP installation defaults to browser launch; choose the normal user option
    // to open the installed app in its own window, without overriding page media.
    await session.send('PWA.changeAppUserSettings', {
      manifestId: baseURL!,
      displayMode: 'standalone',
    });
    const app = await launch(browser);
    await expect(app.getByRole('heading', { name: 'Upscale Compare', exact: true })).toBeVisible();
    await app
      .getByTestId('file-input')
      .setInputFiles([imageFile('Private.png'), imageFile('B.png', 1)]);
    await expect(app.getByTestId('stage')).toBeVisible();
    await app.screenshot({ path: testInfo.outputPath('installed-online.png') });
    await browser.close();
    browser = await chromium.launchPersistentContext(join(directory, 'profile'), {
      ...options,
      offline: true,
    });
    const offline = await launch(browser);
    await expect(offline.getByTestId('stage')).toHaveCount(0);
    const file = imageFile('Fresh.png');
    await offline.getByTestId('file-input').setInputFiles([file, imageFile('Fresh B.png', 1)]);
    expect(await originalBytes(offline)).toEqual(Array.from(file.buffer));
    await offline.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
    await expect(
      offline.getByRole('button', { name: 'Side-by-Side', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await offline.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
    await expect(offline.getByTestId('offline-readiness')).toHaveText(
      'App resources are ready offline.',
    );
    await expect(offline.getByRole('dialog')).toContainText('Version 0.1.0+aaaaaaa1');
    await offline.screenshot({ path: testInfo.outputPath('installed-offline-help.png') });
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
