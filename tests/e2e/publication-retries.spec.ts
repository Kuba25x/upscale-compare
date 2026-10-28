import { expect, test, type Page } from '@playwright/test';
import { openComparison } from './fixtures';

async function confirm(page: Page) {
  await page.getByRole('button', { name: 'Share Comparison', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish comparison', exact: true }).click();
}
const pending = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('upscale-compare:publication:'))
      .map((key) => JSON.parse(localStorage.getItem(key)!)),
  );

test('saves private credentials before uploading and recovers a lost success response without reuploading', async ({
  page,
}) => {
  await openComparison(page);
  let uploads = 0,
    id = '';
  await page.route('**/api/comparisons', async (route) => {
    uploads++;
    const [saved] = await pending(page);
    expect(route.request().headers()['idempotency-key']).toBe(saved.key);
    expect(route.request().headers().authorization).toBe('Bearer ' + saved.deleteToken);
    const response = await route.fetch();
    id = (await response.json()).id;
    await route.abort();
  });
  await confirm(page);
  await expect(page.getByLabel('Public comparison link')).toHaveValue(
    new RegExp('/s/' + '[a-f0-9]{16}$'),
  );
  expect(uploads).toBe(1);
  expect(await pending(page)).toEqual([]);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`upscale-compare:delete:http://localhost:8787:${id}`),
      id,
    ),
  ).toMatch(/^[a-f0-9]{64}$/);
});

test('recovers after reload from the landing page and keeps owner deletion available', async ({
  page,
}) => {
  await openComparison(page);
  let committed = false,
    blockRecovery = true,
    uploads = 0;
  await page.route('**/api/comparisons', async (route) => {
    uploads++;
    await route.fetch();
    committed = true;
    await route.abort();
  });
  await page.route('**/api/publications/result', async (route) => {
    if (committed && blockRecovery) await route.abort();
    else await route.continue();
  });
  await confirm(page);
  await expect(page.getByRole('alert')).toContainText('unavailable');
  const [record] = await pending(page);
  expect(record.deleteToken).toMatch(/^[a-f0-9]{64}$/);
  await page.reload();
  blockRecovery = false;
  await expect(page.getByTestId('stage')).toHaveCount(0);
  await page.getByRole('button', { name: 'Recover publication (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Check publication result', exact: true }).click();
  const link = page.getByLabel('Public comparison link');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(uploads).toBe(1);
  await page.getByText('Manage published comparison', { exact: true }).click();
  await expect(page.getByLabel('Private deletion key')).toHaveValue(record.deleteToken);
  await page.getByRole('button', { name: 'Delete comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comparison deleted' })).toBeVisible();
  await page.goto(url);
  await expect(page.getByRole('alert')).toContainText('Comparison not found');
});

test('retries an unreceived upload with the same saved identity after closing the dialog', async ({
  page,
}) => {
  await openComparison(page);
  const identifiers: string[] = [];
  await page.route('**/api/comparisons', async (route) => {
    identifiers.push(route.request().headers()['idempotency-key']);
    if (identifiers.length === 1) await route.abort();
    else await route.continue();
  });
  await confirm(page);
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await confirm(page);
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(identifiers).toHaveLength(2);
  expect(identifiers[0]).toBe(identifiers[1]);
});

test('checks a pending publication without resending images or losing its saved key', async ({
  page,
}) => {
  await openComparison(page);
  let uploads = 0,
    registered = false;
  await page.route('**/api/comparisons', async (route) => {
    uploads++;
    registered = true;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'pending' }),
    });
  });
  await page.route('**/api/publications/result', (route) =>
    registered
      ? route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'pending' }),
        })
      : route.continue(),
  );
  await confirm(page);
  await expect(page.getByRole('alert')).toContainText('still processing');
  await page.getByRole('button', { name: 'Check publication result', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('still processing');
  expect(uploads).toBe(1);
  expect(await pending(page)).toHaveLength(1);
});

test('refuses uploading when durable private-key storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
  });
  await openComparison(page);
  let uploads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/comparisons') && request.method() === 'POST') uploads++;
  });
  await confirm(page);
  await expect(page.getByRole('alert')).toContainText('could not save the private publication key');
  expect(uploads).toBe(0);
});

test('retains the journal and exposes a backup when final key storage fails', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('upscale-compare:delete:'))
        throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await openComparison(page);
  await confirm(page);
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Download it now');
  const [record] = await pending(page);
  await page.getByText('Manage published comparison', { exact: true }).click();
  await expect(page.getByLabel('Private deletion key')).toHaveValue(record.deleteToken);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download key', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/private-key\.txt$/);
});

test('uses a new identity for changed comparison settings and preserves the unresolved key', async ({
  page,
}) => {
  await openComparison(page);
  const keys: string[] = [];
  await page.route('**/api/comparisons', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) await route.abort();
    else await route.continue();
  });
  await confirm(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Label for image A').fill('Changed label');
  await confirm(page);
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
  expect((await pending(page))[0].key).toBe(keys[0]);
});

test('requires explicit renewed consent for a fresh publication after a terminal result', async ({
  page,
}) => {
  await openComparison(page);
  let terminal = true;
  await page.route('**/api/publications/result', (route) =>
    terminal
      ? route.fulfill({
          status: 410,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'This publication did not complete.' }),
        })
      : route.continue(),
  );
  await confirm(page);
  await expect(
    page.getByRole('button', { name: 'Publish comparison', exact: true }),
  ).toBeDisabled();
  const [original] = await pending(page);
  await page.getByRole('button', { name: 'Start a new publication', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  terminal = false;
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publish comparison', exact: true }).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect((await pending(page))[0].key).toBe(original.key);
});
