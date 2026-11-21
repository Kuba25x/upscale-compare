import { test, expect, type Page } from '@playwright/test';
import { openComparisonHelp, renameSelectedImage } from '../shared/phone-controls';
import { imageFile } from '../e2e/fixtures';
import { cacheSnapshot, control, originalBytes, serve, update } from './helpers';

test.beforeEach(async ({ request }) => serve(request));

for (const { count, from, to } of [
  { count: 1, from: 'a', to: 'b' },
  { count: 2, from: 'a', to: 'b' },
  { count: 2, from: 'b', to: 'a' },
]) {
  test(`release ${from.toUpperCase()} → ${to.toUpperCase()} waits for ${count === 1 ? 'one open view' : 'two open views'} without reloading or losing state`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    await serve(request, from);
    await page.goto(baseURL!);
    await control(page);
    const scriptA = await page.locator('script[type="module"][src]').getAttribute('src');
    const before = await cacheSnapshot(page);
    const file = imageFile('Original A.png');
    const pages = [page];
    if (count === 2) {
      const second = await context.newPage();
      await second.goto(baseURL!);
      pages.push(second);
    }
    for (const view of pages) {
      await view.getByTestId('file-input').setInputFiles([file, imageFile('B.png', 1)]);
      await renameSelectedImage(view, 'A', file.name, 'Keep my comparison');
      await view.getByRole('button', { name: '200%', exact: true }).click();
      await view.evaluate(() => {
        (window as any).__originalLayers = [...document.querySelectorAll('.comparison-image')];
      });
    }
    const foreign = await page.evaluate(async () => {
      const name = `foreign-precache-${location.origin}${new URL(document.baseURI).pathname}`;
      await (await caches.open(name)).put('/foreign-state', new Response('keep foreign data'));
      localStorage.setItem('upscale-compare:delete:sentinel', 'keep deletion key');
      return name;
    });
    await serve(request, to);
    expect(await update(page)).toBe('installed');
    const waiting = await page.evaluate(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
    );
    expect(waiting).toBe(true);
    const afterInstall = await cacheSnapshot(page);
    for (const [name, keys] of Object.entries(before))
      for (const key of keys) expect(afterInstall[name]).toContain(key);
    for (const view of pages) {
      await expect(view.getByLabel('Select image A').locator('option:checked')).toHaveText(
        'Keep my comparison',
      );
      await expect(view.getByTestId('stage')).toHaveAttribute('data-zoom', '2');
      expect(await view.locator('script[type="module"][src]').getAttribute('src')).toBe(scriptA);
      expect(
        await view.evaluate(() =>
          [...document.querySelectorAll('.comparison-image')].every(
            (n, i) => n === (window as any).__originalLayers[i],
          ),
        ),
      ).toBe(true);
      expect(await originalBytes(view)).toEqual(Array.from(file.buffer));
      const help = await openComparisonHelp(view);
      await expect(view.getByTestId('offline-readiness')).toHaveText(
        'App resources are ready offline.',
      );
      await expect(help).toContainText(`Version 0.1.0+${from === 'a' ? 'aaaaaaa1' : 'bbbbbbb2'}`);
      await help.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    if (count === 2) {
      await pages[1].close();
      expect(
        await page.evaluate(async () =>
          Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
        ),
      ).toBe(true);
    }
    await page.close();
    let fresh!: Page;
    // An immediate new navigation may briefly retain A during the final client's
    // destruction. Close such probes so they cannot themselves hold B waiting.
    await expect
      .poll(async () => {
        const probe = await context.newPage();
        await probe.goto(baseURL!);
        if ((await probe.locator('script[type="module"][src]').getAttribute('src')) === scriptA) {
          await probe.close();
          return false;
        }
        fresh = probe;
        return true;
      })
      .toBe(true);
    await expect(fresh.locator('script[type="module"][src]')).not.toHaveAttribute('src', scriptA!);
    await expect(fresh.getByTestId('stage')).toHaveCount(0);
    expect(
      await fresh.evaluate(
        async ({ foreign }) => ({
          foreign: await (await (await caches.open(foreign)).match('/foreign-state'))!.text(),
          key: localStorage.getItem('upscale-compare:delete:sentinel'),
        }),
        { foreign },
      ),
    ).toEqual({ foreign: 'keep foreign data', key: 'keep deletion key' });
    const after = await cacheSnapshot(fresh);
    expect(Object.values(after).flat()).not.toContain(new URL(scriptA!, baseURL).href);
  });
}

for (const fault of ['missing', 'network', 'corrupt']) {
  test(`failed B install (${fault}) preserves the active A shell and local comparison`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    await page.goto(baseURL!);
    await control(page);
    const script = await page.locator('script[type="module"][src]').getAttribute('src');
    const before = await cacheSnapshot(page);
    const file = imageFile('Unmodified original.png');
    await page.getByTestId('file-input').setInputFiles([file, imageFile('B.png', 1)]);
    await renameSelectedImage(page, 'A', file.name, 'Keep failed-update state');
    await serve(request, 'b', fault);
    expect(await update(page)).toBe('redundant');
    await expect(page.getByLabel('Select image A').locator('option:checked')).toHaveText(
      'Keep failed-update state',
    );
    expect(await originalBytes(page)).toEqual(Array.from(file.buffer));
    const after = await cacheSnapshot(page);
    for (const [name, keys] of Object.entries(before))
      for (const key of keys) expect(after[name]).toContain(key);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', script!);
    await page.getByTestId('file-input').setInputFiles([file, imageFile('B.png', 1)]);
    await expect(page.getByTestId('stage')).toBeVisible();
    expect(await originalBytes(page)).toEqual(Array.from(file.buffer));
  });
}
