import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
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
              name: 'SystemBars',
              methods: ['hide', 'show'].map((name) => ({ name, rtype: 'promise' })),
            },
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
                rtype: name === 'addListener' ? 'callback' : 'promise',
              })),
            },
          ],
          convertFileSrc: (path: string) => path,
          nativeCallback: (_plugin: string, method: string, args: any, callback: any) => {
            if (method === 'addListener') win[`listener-${args.eventName}`] = callback;
            return args.eventName;
          },
          nativePromise: async (plugin: string, method: string, args: any) => {
            if (plugin === 'SystemBars') {
              win.barsHidden = method === 'hide';
              return {};
            }
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
    await expect
      .poll(() =>
        page
          .getByTestId('image-A')
          .evaluate((node: HTMLImageElement) => [
            node.complete,
            node.naturalWidth,
            node.naturalHeight,
          ]),
      )
      .toEqual([true, width, height]);
    await page.getByRole('button', { name: '100%', exact: true }).click();
    const bounds = await page.getByTestId('image-A').boundingBox();
    expect(bounds!.width * 3).toBeCloseTo(width, 2);
    expect(bounds!.height * 3).toBeCloseTo(height, 2);
    const stageBox = (await page.getByTestId('stage').boundingBox())!;
    const shot = PNG.sync.read(await page.screenshot());
    const pixelX = Math.round((stageBox.x + stageBox.width * 0.25) * 3);
    const pixelY = Math.round((stageBox.y + stageBox.height * 0.55) * 3);
    const sourceX = pixelX - Math.round(bounds!.x * 3);
    const sourceY = pixelY - Math.round(bounds!.y * 3);
    const offset = (pixelY * shot.width + pixelX) * 4;
    expect([...shot.data.subarray(offset, offset + 4)]).toEqual([
      sourceX % 256,
      sourceY % 256,
      80,
      255,
    ]);
    const client = await page.context().newCDPSession(page);
    for (const mode of ['Split Screen', 'Side-by-Side']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      const x = Math.round(stageBox.x + 60),
        y = Math.round(stageBox.y + stageBox.height / 2);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x, y: y - 40, id: 1 },
          { x, y: y + 40, id: 2 },
        ],
      });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x, y: y - 60, id: 1 },
          { x, y: y + 60, id: 2 },
        ],
      });
      await expect
        .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-zoom')))
        .toBeCloseTo(1.5, 5);
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await expect(page.getByTestId('stage')).not.toHaveClass(/panning/);
      await page.getByRole('button', { name: '100%', exact: true }).click();
    }
    await client.detach();
    await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const config = JSON.parse(localStorage.getItem('test-session')!).config;
          return [config.mode, config.view.zoom];
        }),
      )
      .toEqual(['side', 1]);
    await page.reload();
    await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1');
    await expect(page.getByRole('button', { name: 'Side-by-Side', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).barsHidden)).toBe(true);
    await page.evaluate(() => (window as any)['listener-backButton']({ canGoBack: false }));
    await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).barsHidden)).toBe(false);
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
