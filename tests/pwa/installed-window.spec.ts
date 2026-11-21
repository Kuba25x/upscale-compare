import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageFile } from '../e2e/fixtures';
import { expectLocalComparisonUI } from '../shared/local-comparison';
import { expectCenteredBrand, expectCenteredDividerArrows } from '../shared/layout-alignment';
import { control, originalBytes, serve } from './helpers';

test('installed Linux Chromium window uses the manifest launch URL and reopens offline', async ({
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
      .poll(() =>
        app.evaluate(
          () =>
            matchMedia('(display-mode: fullscreen)').matches ||
            matchMedia('(display-mode: standalone)').matches,
        ),
      )
      .toBe(true);
    expect(new URL(app.url()).searchParams.get('pwa')).toBe('fullscreen');
    expect(await app.evaluate(() => document.fullscreenElement)).toBeNull();
    const mode = await app.evaluate(() =>
      matchMedia('(display-mode: fullscreen)').matches ? 'fullscreen' : 'standalone',
    );
    testInfo.annotations.push({ type: 'installed-display-mode', description: mode });
    if (mode === 'fullscreen')
      await expect(app.locator('.app')).toHaveClass(/installed-fullscreen/);
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
    // Desktop CDP exposes browser/standalone window preferences, not a native
    // fullscreen preference. Select an app window and record the browser's actual
    // manifest mode/fallback; never emulate fullscreen media or request it via JS.
    await session.send('PWA.changeAppUserSettings', {
      manifestId: baseURL!,
      displayMode: 'standalone',
    });
    const app = await launch(browser);
    await expectCenteredBrand(app);
    await app
      .getByTestId('file-input')
      .setInputFiles([imageFile('Private.png'), imageFile('B.png', 1)]);
    await expect(app.getByTestId('stage')).toBeVisible();
    await expectCenteredDividerArrows(app);
    await expectLocalComparisonUI(app);
    await app.screenshot({ path: testInfo.outputPath('installed-online.png') });
    await browser.close();
    browser = await chromium.launchPersistentContext(join(directory, 'profile'), {
      ...options,
      offline: true,
    });
    const offline = await launch(browser);
    await expect(offline.getByTestId('stage')).toHaveCount(0);
    const file = imageFile('Fresh.png');
    const other = imageFile('Fresh B.png', 1);
    await offline.getByTestId('file-input').setInputFiles([file, other]);
    expect(await originalBytes(offline)).toEqual(Array.from(file.buffer));
    await expectLocalComparisonUI(offline);
    await offline.getByRole('button', { name: 'Manage Images', exact: true }).click();
    const dialog = offline.getByRole('dialog', { name: 'Your images' });
    await dialog.getByRole('button', { name: 'Remove image Fresh B.png' }).click();
    await expect(offline.getByTestId('stage')).toHaveCount(0);
    const chooser = offline.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Add images' }).click();
    await (await chooser).setFiles(other);
    await expect(dialog.getByRole('button', { name: 'Remove image Fresh B.png' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
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
