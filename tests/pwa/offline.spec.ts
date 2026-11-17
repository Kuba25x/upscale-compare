import { test, expect } from '@playwright/test';
import { imageFile } from '../e2e/fixtures';
import { cacheSnapshot, control, originalBytes, serve } from './helpers';

test.beforeEach(async ({ request }) => serve(request));

test('offline shell restarts empty and keeps local originals, metadata, zoom and modes private', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  await page.goto(baseURL!);
  await control(page);
  const registration = await page.evaluate(async () => {
    const r = (await navigator.serviceWorker.getRegistration())!;
    return { scope: r.scope, script: r.active!.scriptURL, updateViaCache: r.updateViaCache };
  });
  expect(registration).toEqual({
    scope: baseURL,
    script: new URL('sw.js', baseURL).href,
    updateViaCache: 'none',
  });
  if (browserName === 'chromium') {
    const session = await context.newCDPSession(page);
    await session.send('ServiceWorker.stopAllWorkers');
    await session.detach();
  }
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(baseURL!);
  await expect(offline.getByTestId('stage')).toHaveCount(0);
  const before = await cacheSnapshot(offline);
  const file = imageFile('Private Original.png');
  await offline.getByTestId('file-input').setInputFiles([file, imageFile('Private B.png', 1)]);
  await expect(offline.getByTestId('stage')).toBeVisible();
  expect(await originalBytes(offline)).toEqual(Array.from(file.buffer));
  await offline.getByLabel('Label for image A').fill('Private label');
  await offline.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await offline.getByLabel('Game title').fill('Private game');
  await offline.getByRole('button', { name: 'Save details', exact: true }).click();
  const stage = offline.getByTestId('stage');
  for (const mode of ['Split Screen', 'Side-by-Side']) {
    await offline.getByRole('button', { name: mode, exact: true }).click();
    await offline.getByRole('button', { name: '200%', exact: true }).click();
    await expect(stage).toHaveAttribute('data-zoom', '2');
    await offline.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(stage).toHaveAttribute('data-zoom', 'fit');
    await offline.getByRole('button', { name: '100%', exact: true }).click();
    await stage.click({ position: { x: 60, y: 60 } });
    const beforePan = await offline.getByTestId('image-A').boundingBox();
    await offline.keyboard.press('ArrowRight');
    await expect
      .poll(async () => (await offline.getByTestId('image-A').boundingBox())!.x)
      .not.toBe(beforePan!.x);
    if (browserName === 'chromium') {
      const cdp = await context.newCDPSession(offline);
      const box = (await stage.boundingBox())!;
      const contacts = (distance: number) => [
        { x: box.x + 70, y: box.y + 90 - distance, id: 1 },
        { x: box.x + 70, y: box.y + 90 + distance, id: 2 },
      ];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts(25) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts(50) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(stage).toHaveAttribute('data-zoom', '2');
      await cdp.detach();
    }
  }
  await expect(
    offline.getByRole('button', { name: 'Share Comparison', exact: true }),
  ).toBeDisabled();
  expect(await cacheSnapshot(offline)).toEqual(before);
  expect(
    await offline.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
  ).toEqual({ local: {}, session: {} });
  await offline.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await expect(offline.getByLabel('Game title')).toHaveValue('Private game');
  await offline.getByRole('button', { name: 'Save details', exact: true }).click();
  await offline.close();
  const restarted = await context.newPage();
  await restarted.goto(baseURL!);
  await expect(restarted.getByTestId('stage')).toHaveCount(0);
  await restarted.getByTestId('file-input').setInputFiles([file, imageFile('Fresh B.png', 1)]);
  await expect(restarted.getByLabel('Label for image A')).toHaveValue('Private Original');
  await restarted.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await expect(restarted.getByLabel('Game title')).toHaveValue('');
});

test('only the shell entry points work offline; API, tokens, share paths and foreign cache stay outside it', async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto(baseURL!);
  await control(page);
  const before = await cacheSnapshot(page);
  expect(Object.keys(before)).toHaveLength(1);
  const entries = Object.values(before).flat();
  for (const url of entries) {
    const path = new URL(url).pathname;
    expect(path.startsWith(new URL(baseURL!).pathname)).toBeTruthy();
    expect(path).toMatch(
      /(?:index\.html|assets\/[^/]+\.(?:js|css)|icons\/[^/]+\.png|favicon\.svg|third-party-licenses\.txt|manifest\.webmanifest)$/,
    );
  }
  await page.evaluate(async () => {
    await fetch('api/private?token=private-token');
    await fetch('api/publish', { method: 'POST', body: 'private-image-and-token' });
    await fetch('s/private-link');
  });
  expect(await cacheSnapshot(page)).toEqual(before);
  await context.setOffline(true);
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('api/private?token=private-token');
        return true;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  await page.goto(new URL('index.html#c/private-link', baseURL).href);
  await expect(page.locator('.app')).toBeVisible();
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('s/private-link');
        return true;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  if (new URL(baseURL!).pathname !== '/') {
    const outside = await context.newPage();
    await expect(outside.goto(new URL('/', baseURL).href)).rejects.toThrow();
    await outside.close();
  }
});

test('failed first registration leaves the online comparison usable and can recover', async ({
  page,
  request,
  baseURL,
}) => {
  await serve(request, 'a', 'worker');
  const failed = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('Offline app shell unavailable'),
  });
  await page.goto(baseURL!);
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('B.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  await failed;
  await expect
    .poll(() =>
      page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)),
    )
    .toBe(false);
  await serve(request);
  await page.reload();
  await control(page);
  await expect(page.getByTestId('file-input')).toBeAttached();
});
