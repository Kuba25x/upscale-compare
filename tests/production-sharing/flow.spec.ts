import {
  test,
  expect,
  openLocalComparison,
  openShare,
  publishButton,
  solve,
  settings,
} from './fixtures';

test('expired verification disables publishing until a fresh token arrives', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await solve(page);
  await expect(publishButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Expire local verification', exact: true }).click();
  await expect(publishButton(page)).toBeDisabled();
  expect(sharing.verification.requests).toHaveLength(0);
  await solve(page);
  await publishButton(page).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(sharing.verification.requests).toHaveLength(1);
});

test('rejected verification resets the widget and retries the same operation with a fresh token', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await solve(page, 'invalid-');
  const identifiers: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/comparisons') && request.method() === 'POST')
      identifiers.push(request.headers()['idempotency-key']);
  });
  await publishButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Verification failed or expired');
  await expect(publishButton(page)).toBeDisabled();
  await sharing.empty();
  await solve(page);
  await publishButton(page).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(identifiers).toHaveLength(2);
  expect(identifiers[0]).toBe(identifiers[1]);
  expect(sharing.verification.requests).toHaveLength(2);
  expect(sharing.verification.requests[0].token).not.toBe(sharing.verification.requests[1].token);
});

test('recovers a lost success response without another upload or verification', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await solve(page);
  let uploads = 0;
  await page.route(settings.apiOrigin + '/api/comparisons', async (route) => {
    uploads++;
    expect((await route.fetch()).status()).toBe(201);
    await route.abort();
  });
  await publishButton(page).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(uploads).toBe(1);
  expect(sharing.verification.requests).toHaveLength(1);
});

test('recovers after refresh while uploads and verification are disabled', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await solve(page);
  let committed = false,
    blocked = true,
    uploads = 0;
  await page.route(settings.apiOrigin + '/api/comparisons', async (route) => {
    uploads++;
    expect((await route.fetch()).status()).toBe(201);
    committed = true;
    await route.abort();
  });
  await page.route(settings.apiOrigin + '/api/publications/result', (route) =>
    committed && blocked ? route.abort() : route.continue(),
  );
  await publishButton(page).click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await sharing.setUploads(false, '');
  blocked = false;
  await page.reload();
  await page.getByRole('button', { name: 'Recover publication (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Check publication result', exact: true }).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  await page.getByText('Manage published comparison', { exact: true }).click();
  await expect(page.getByLabel('Private deletion key')).not.toHaveValue('');
  expect(sharing.scriptRequests).toBe(1);
  expect(sharing.verification.requests).toHaveLength(1);
  expect(uploads).toBe(1);
});

test('retries a provider widget error with one active widget and no automatic publication', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await solve(page);
  await page.getByRole('button', { name: 'Fail local verification', exact: true }).click();
  await expect(publishButton(page)).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Verification could not load');
  await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
  await expect(page.locator('[data-local-widget]')).toHaveCount(1);
  await solve(page);
  await publishButton(page).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(sharing.scriptRequests).toBe(1);
  expect(sharing.verification.requests).toHaveLength(1);
});

test('contains provider render exceptions and lets the publisher retry', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __localVerification: object }).__localVerification = {
      renderFailures: 1,
    };
  });
  await openLocalComparison(page);
  await openShare(page);
  await expect(page.getByRole('alert')).toContainText('Verification could not load');
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
  await solve(page);
  await page.getByRole('checkbox').check();
  await publishButton(page).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
});

test('creates one widget when a dialog closes and reopens while its script is pending', async ({
  page,
  sharing,
}) => {
  let release!: () => void;
  sharing.scriptGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await openLocalComparison(page);
    await openShare(page);
    await expect.poll(() => sharing.scriptRequests).toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openShare(page);
    release();
    await expect(page.locator('[data-local-widget]')).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __localVerification: { renders: number } }).__localVerification
              .renders,
        ),
      )
      .toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __localVerification: { active: number } }).__localVerification
              .active,
        ),
      )
      .toBe(0);
  } finally {
    release();
  }
});

test('times out a stalled provider script and leaves an explicit retry available', async ({
  page,
  sharing,
}) => {
  let release!: () => void;
  sharing.scriptGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.clock.install();
    await openLocalComparison(page);
    await openShare(page);
    await expect.poll(() => sharing.scriptRequests).toBe(1);
    await page.clock.fastForward(15001);
    await expect(page.getByRole('alert')).toContainText('Verification could not load');
    await expect(
      page.getByRole('button', { name: 'Retry verification', exact: true }),
    ).toBeVisible();
    await expect(publishButton(page)).toBeDisabled();
    expect(sharing.verification.requests).toHaveLength(0);
  } finally {
    release();
  }
});

for (const reason of ['uploads disabled', 'missing backend secret']) {
  test(`does not contact verification when publishing is unavailable: ${reason}`, async ({
    page,
    sharing,
  }) => {
    await sharing.setUploads(
      reason !== 'uploads disabled',
      reason === 'missing backend secret' ? '' : undefined,
    );
    await openLocalComparison(page);
    await openShare(page);
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('dialog')).toContainText('Public uploads are currently disabled');
    await expect(publishButton(page)).toBeDisabled();
    expect(sharing.scriptRequests).toBe(0);
    expect(sharing.verification.requests).toHaveLength(0);
    await sharing.empty();
  });
}

test('enforces an emergency stop after the dialog received healthy production readiness', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await solve(page);
  await expect(publishButton(page)).toBeEnabled();
  await (
    await sharing.mf.getD1Database('DB')
  ).exec('UPDATE service_control SET publishing_paused = 1, generation = generation + 1;');
  await publishButton(page).click();
  await expect(page.getByRole('alert')).toContainText('paused');
  expect(sharing.verification.requests).toHaveLength(0);
  await sharing.empty();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.getByTestId('stage')).toBeVisible();
});

test('refuses sharing when production CORS excludes the actual frontend origin', async ({
  page,
  sharing,
}) => {
  await sharing.setAllowedOrigin('http://other.example');
  await openLocalComparison(page);
  await openShare(page);
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await page.getByRole('checkbox').check();
  await expect(publishButton(page)).toBeDisabled();
  expect(sharing.scriptRequests).toBe(0);
  expect(sharing.verification.requests).toHaveLength(0);
  await sharing.empty();
});

test('publishes after consent and verification, restores the repository subpath, and deletes as owner', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  expect(sharing.scriptRequests).toBe(0);
  await openShare(page);
  await expect(publishButton(page)).toBeDisabled();
  await expect(page.locator('[data-local-widget]')).toHaveAttribute('data-action', 'publish');
  await expect(page.locator('[data-local-widget]')).toHaveAttribute(
    'data-sitekey',
    settings.siteKey,
  );
  await solve(page);
  await expect(publishButton(page)).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(publishButton(page)).toBeEnabled();
  await publishButton(page).click();
  const link = page.getByLabel('Public comparison link');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(new RegExp('^' + settings.apiOrigin + '/s/[a-f0-9]{16}$'));
  expect(sharing.verification.requests).toHaveLength(1);
  expect(sharing.verification.requests[0].correctSecret).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (
          window as unknown as { __localVerification: { active: number; resets: number } }
        ).__localVerification;
        return { active: state.active, resets: state.resets };
      }),
    )
    .toEqual({ active: 0, resets: 0 });
  await page.getByText('Manage published comparison', { exact: true }).click();
  const key = await page.getByLabel('Private deletion key').inputValue();
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(url).not.toContain(key);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download key', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('private-key.txt');
  await page.goto(url);
  await expect(page).toHaveURL(new RegExp('/upscale-compare/#c/[a-f0-9]{16}$'));
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('stage')).toBeVisible();
  await openShare(page);
  await page.getByText('Manage published comparison', { exact: true }).click();
  await expect(page.getByLabel('Private deletion key')).toHaveValue(key);
  await page.getByRole('button', { name: 'Delete comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comparison deleted' })).toBeVisible();
  await sharing.empty();
});

test('retries a failed provider script without closing the publication dialog', async ({
  page,
  sharing,
}) => {
  sharing.scriptFailures = 1;
  await openLocalComparison(page);
  await openShare(page);
  await expect(page.getByRole('alert')).toContainText('Verification could not load');
  await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
  await solve(page);
  await page.getByRole('checkbox').check();
  await publishButton(page).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(sharing.scriptRequests).toBe(2);
});

test('reopens verification after a provider script failure instead of retaining a dead script', async ({
  page,
  sharing,
}) => {
  sharing.scriptFailures = 1;
  await openLocalComparison(page);
  await openShare(page);
  await expect(page.getByRole('alert')).toContainText('Verification could not load');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openShare(page);
  await expect(
    page.getByRole('button', { name: 'Complete local verification', exact: true }),
  ).toBeVisible();
  expect(sharing.scriptRequests).toBe(2);
});

test('contains reset failures after a rejected token and allows explicit verification retry', async ({
  page,
  sharing,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __localVerification: object }).__localVerification = {
      resetFailures: 1,
    };
  });
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await solve(page, 'invalid-');
  await publishButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Verification could not load');
  await page.getByRole('button', { name: 'Retry verification', exact: true }).click();
  await solve(page);
  await publishButton(page).click();
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  expect(sharing.verification.requests).toHaveLength(2);
});
