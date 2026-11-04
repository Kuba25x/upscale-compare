import { test, expect } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';

for (const [width, height] of [
  [3840, 2160],
  [7680, 4320],
]) {
  test(`offline Android bridge flow and exact scaling at ${width}x${height}`, async ({ page }) => {
    const image = imageFile('Original.png', 0, width, height);
    const requests: string[] = [];
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:4176' || /\/(api|s)\//.test(url.pathname)) {
        requests.push(url.href);
        return route.abort();
      }
      if (url.pathname.startsWith('/original-'))
        return route.fulfill({ contentType: 'image/png', body: image.buffer });
      return route.continue();
    });
    await page.addInitScript(
      ({ width, height, size }) => {
        const win = window as any;
        const originals = [1, 2].map((n) => ({
          id: `00000000-0000-4000-8000-00000000000${n}`,
          name: `Original ${n}.png`,
          type: 'image/png',
          width,
          height,
          size,
          sha256: 'a'.repeat(64),
        }));
        const paths = Object.fromEntries(
          originals.map((i, n) => [i.id, `${location.origin}/original-${n}.png`]),
        );
        win.androidBridge = {};
        win.Capacitor = {
          PluginHeaders: [
            {
              name: 'Originals',
              methods: ['pick', 'restore', 'paths', 'save', 'discard'].map((name) => ({
                name,
                rtype: 'promise',
              })),
            },
            {
              name: 'App',
              methods: ['toggleBackButtonHandler', 'addListener', 'removeListener'].map((name) => ({
                name,
                rtype: 'promise',
              })),
            },
          ],
          convertFileSrc: (path: string) => path,
          nativeCallback: () => {},
          nativePromise: async (plugin: string, method: string, args: any) => {
            if (plugin === 'App') return {};
            if (method === 'restore')
              return { session: JSON.parse(localStorage.getItem('test-session') || 'null'), paths };
            if (method === 'pick') return { images: win.cancelPick ? [] : originals };
            if (method === 'paths') return { paths };
            if (method === 'save') {
              localStorage.setItem('test-session', JSON.stringify(args.session));
              return {};
            }
            return {};
          },
        };
      },
      { width, height, size: image.buffer.length },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
    await expect(page.getByTestId('stage')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Share Comparison', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: '100%', exact: true }).click();
    const bounds = await page.getByTestId('image-A').boundingBox();
    expect(bounds!.width * 3).toBeCloseTo(width, 2);
    expect(bounds!.height * 3).toBeCloseTo(height, 2);
    await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('test-session')!).config.mode),
      )
      .toBe('side');
    await page.reload();
    await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1');
    await expect(page.getByRole('button', { name: 'Side-by-Side', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Upload Images', exact: true }).click();
    await expect(page.locator('.upload-list img')).toHaveCount(0);
    await page.evaluate(() => {
      (window as any).cancelPick = true;
    });
    await page.getByRole('button', { name: 'Replace all images' }).click();
    await expect(page.getByRole('button', { name: 'Clear comparison' })).toBeEnabled();
    await expect(page.getByTestId('stage')).toBeVisible();
    await page.getByRole('button', { name: 'Clear comparison' }).click();
    await expect(page.getByTestId('stage')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('test-session')!).images.length),
      )
      .toBe(0);
    expect(requests).toEqual([]);
  });
}
