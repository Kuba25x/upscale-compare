import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { original } from '../../../tests/fixtures/fidelity';
import { parseComparison, type Original } from '../manifest';
import { APP_ORIGIN, APP_URL, FIXTURE_NAMES, LINK_LIMIT, PROVIDER_ORIGIN } from '../settings';

const allowOrigin = { 'Access-Control-Allow-Origin': APP_ORIGIN };
const cdnPath = (file: Original) => `${PROVIDER_ORIGIN}/${file.uuid}/`;
const create = (page: Page) => page.getByRole('button', { name: 'Publish mock comparison' });
const link = (page: Page) => page.getByRole('textbox', { name: 'Comparison link' });

async function authorize(page: Page) {
  await expect(page.getByTestId('image-A')).toBeVisible();
  await expect(create(page)).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand/ }).check();
  await expect(create(page)).toBeEnabled();
}

async function publish(page: Page) {
  await authorize(page);
  await create(page).click();
  await expect(link(page)).toBeVisible();
  return link(page).inputValue();
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
});

for (const count of [2, 3, 4]) {
  test(`round trips ${count} byte-identical originals in a fresh browser context`, async ({
    page,
    browser,
  }) => {
    if (count === 2) await page.getByRole('checkbox', { name: FIXTURE_NAMES[2] }).uncheck();
    if (count === 4) await page.getByRole('checkbox', { name: FIXTURE_NAMES[3] }).check();
    await authorize(page);
    const description = 'Fidelity check — 画質 🖼';
    await page.getByRole('textbox', { name: 'Description' }).fill(description);
    const a = count - 1;
    await page.getByRole('combobox', { name: 'Image A', exact: true }).selectOption(String(a));
    await page.getByRole('slider', { name: 'Comparison divider' }).press('Shift+ArrowRight');
    await page.getByRole('button', { name: '200%', exact: true }).click();
    if (count === 4) await page.getByRole('button', { name: 'Side by side' }).click();
    await create(page).click();
    await expect(page.getByText(`SHA-256 verified for ${count} originals.`)).toBeVisible();
    const url = await link(page).inputValue();
    expect(url.length).toBeLessThanOrEqual(LINK_LIMIT);
    const comparison = parseComparison(new URL(url).hash);
    expect(comparison.metadata.description).toBe(description);
    expect(comparison.config.selected).toEqual([a, count === 2 ? 0 : 1]);
    expect(comparison.config.view.zoom).toBe(2);

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const visitor = await context.newPage();
      const requests: string[] = [];
      visitor.on('request', (request) => requests.push(request.url()));
      await visitor.goto(url);
      const [imageA, imageB] = comparison.config.selected.map((index) =>
        original(FIXTURE_NAMES[index]),
      );
      for (const [side, file] of [
        ['A', imageA],
        ['B', imageB],
      ] as const) {
        const image = visitor.getByTestId(`image-${side}`);
        await expect(image).toHaveAttribute('width', String(file.width));
        await expect(image).toHaveAttribute('height', String(file.height));
        await expect(image).toHaveAttribute('src', /^blob:/);
        expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(
          file.width,
        );
      }
      if (count === 4) {
        await expect(visitor.getByRole('button', { name: 'Side by side' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      } else {
        await expect(visitor.getByRole('slider', { name: 'Comparison divider' })).toHaveAttribute(
          'aria-valuenow',
          '60',
        );
      }
      await expect(visitor.getByLabel('Current zoom')).toHaveText('200%');
      await visitor.getByRole('button', { name: 'Comparison details' }).click();
      await expect(visitor.getByRole('dialog')).toContainText(description);
      await visitor.getByRole('button', { name: 'Close dialog' }).click();

      for (const [index, entry] of comparison.images.entries()) {
        const file = original(FIXTURE_NAMES[index]);
        await visitor.getByRole('combobox', { name: 'Image A' }).selectOption(String(index));
        const image = visitor.getByTestId('image-A');
        await expect(image).toHaveAttribute('alt', entry.label);
        const bytes = Buffer.from(
          await image.evaluate(async (node: HTMLImageElement) => {
            const response = await fetch(node.src);
            return Array.from(new Uint8Array(await response.arrayBuffer()));
          }),
        );
        expect(bytes.equals(file.buffer)).toBe(true);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
        expect(comparison.images[index]).toMatchObject({
          sha256: file.sha256,
          size: file.size,
          type: file.type,
        });
      }
      expect(
        requests.every(
          (url) => !url.includes('#') && !url.includes(encodeURIComponent(description)),
        ),
      ).toBe(true);
      expect(requests.filter((url) => url.startsWith(PROVIDER_ORIGIN))).toEqual(
        comparison.images.map(cdnPath),
      );
      expect(
        requests.every((url) => [APP_ORIGIN, PROVIDER_ORIGIN].includes(new URL(url).origin)),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
}

test('rejects oversized metadata before requesting a permit', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(PROVIDER_ORIGIN)) requests.push(request.url());
  });
  await authorize(page);
  await page.getByRole('textbox', { name: 'Description' }).fill('画'.repeat(900));
  await create(page).click();
  await expect(page.getByRole('alert')).toContainText('link is too long');
  await expect(link(page)).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('rejects malformed, unknown-version, and untrusted-host manifests before requesting images', async ({
  page,
}) => {
  const valid = await publish(page);
  const manifest = parseComparison(new URL(valid).hash);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(PROVIDER_ORIGIN)) requests.push(request.url());
  });
  for (const hash of [
    '#uc-poc/1/%',
    '#uc-poc/2/e30',
    `#uc-poc/1/${'a'.repeat(LINK_LIMIT)}`,
    `#uc-poc/1/${encode({ ...manifest, images: [manifest.images[0], manifest.images[0]] })}`,
    `#uc-poc/1/${encode({
      ...manifest,
      images: [{ ...manifest.images[0], url: 'https://invalid.example/' }, manifest.images[1]],
    })}`,
  ]) {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, hash);
    await expect(page.getByRole('alert')).toContainText('link is invalid');
    await expect(page.getByTestId('image-A')).toHaveCount(0);
  }
  expect(requests).toEqual([]);
});

test('a failed second upload leaves no link and requires an explicit retry', async ({ page }) => {
  const api = PROVIDER_ORIGIN + '/base/';
  let uploads = 0;
  await page.route(api, async (route) => {
    if (route.request().method() !== 'POST' || ++uploads !== 2) return route.continue();
    await route.fulfill({ status: 503, headers: allowOrigin });
  });
  await authorize(page);
  await create(page).click();
  await expect(page.getByRole('alert')).toContainText('temporary uploads expire');
  await expect(link(page)).toHaveCount(0);
  expect(uploads).toBe(2);
  await page.unroute(api);
  await create(page).click();
  await expect(link(page)).toBeVisible();
});

for (const [status, message] of [
  [401, 'permit was refused or expired'],
  [413, 'rejected the upload size'],
  [429, 'reached its usage limit'],
] as const) {
  test(`handles provider refusal ${status} without publishing`, async ({ page }) => {
    await page.route(PROVIDER_ORIGIN + '/base/', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status, headers: allowOrigin })
        : route.continue(),
    );
    await authorize(page);
    await create(page).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(link(page)).toHaveCount(0);
  });
}

test('withholds a link when original verification fails after all uploads', async ({ page }) => {
  await page.route(new RegExp(`^${PROVIDER_ORIGIN}/[0-9a-f-]+/$`), async (route) => {
    const response = await route.fetch();
    const bytes = await response.body();
    bytes[0] ^= 1;
    await route.fulfill({ response, body: bytes });
  });
  await authorize(page);
  await create(page).click();
  await expect(page.getByRole('alert')).toContainText('does not match its SHA-256');
  await expect(link(page)).toHaveCount(0);
});

for (const failure of [
  { kind: 'expired', message: 'An original is unavailable' },
  { kind: 'CORS denied', message: 'mock provider is unavailable' },
  { kind: 'altered', message: 'does not match its SHA-256' },
  { kind: 'oversized', message: 'exceeds its declared size' },
]) {
  test(`fails closed when a later original is ${failure.kind}`, async ({ page }) => {
    const url = await publish(page);
    const [, second] = parseComparison(new URL(url).hash).images;
    await page.route(cdnPath(second), async (route) => {
      if (failure.kind === 'expired') return route.fulfill({ status: 410, headers: allowOrigin });
      if (failure.kind === 'CORS denied') {
        return route.fulfill({
          status: 200,
          headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:1' },
          contentType: second.type,
          body: '',
        });
      }
      const response = await route.fetch();
      const bytes = await response.body();
      if (failure.kind === 'oversized') {
        return route.fulfill({
          response,
          headers: { ...response.headers(), 'content-length': String(bytes.length + 1) },
          body: Buffer.concat([bytes, Buffer.of(0)]),
        });
      }
      bytes[0] ^= 1;
      return route.fulfill({ response, body: bytes });
    });
    await page.goto(url);
    await expect(page.getByRole('alert')).toContainText(failure.message);
    await expect(page.getByTestId('image-A')).toHaveCount(0);
    await expect(page.getByTestId('image-B')).toHaveCount(0);
  });
}
