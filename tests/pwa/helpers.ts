import { expect, type Page, type APIRequestContext } from '@playwright/test';

export async function serve(request: APIRequestContext, release = 'a', fault = 'none') {
  expect(
    (
      await request.post('http://127.0.0.1:4188/__pwa_test__/state', { data: { release, fault } })
    ).ok(),
  ).toBeTruthy();
}
export async function control(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state))
    .toBe('activated');
}
export async function cacheSnapshot(page: Page) {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {};
    for (const name of (await caches.keys()).sort())
      result[name] = (await (await caches.open(name)).keys()).map((r) => r.url).sort();
    return result;
  });
}
export async function update(page: Page) {
  return page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    return new Promise<string>((resolve) => {
      registration.addEventListener(
        'updatefound',
        () => {
          const worker = registration.installing!;
          const changed = () => {
            if (worker.state === 'installed' || worker.state === 'redundant') resolve(worker.state);
          };
          worker.addEventListener('statechange', changed);
          changed();
        },
        { once: true },
      );
      registration.update().catch(() => resolve('rejected'));
    });
  });
}
export async function originalBytes(page: Page) {
  return page
    .getByTestId('image-A')
    .evaluate(async (image: HTMLImageElement) =>
      Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())),
    );
}
