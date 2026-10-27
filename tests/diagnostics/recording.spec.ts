import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openViewer, points } from '../shared/pinch';
import { imageFile } from '../e2e/fixtures';

async function start(page: Page) {
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function stop(page: Page) {
  await page.getByRole('button', { name: 'Stop diagnostic log', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download log', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^upscale-compare-.*-gestures.json$/);
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

test('phone-friendly export and insecure-context copy fallback preserve privacy and stay local', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Diagnostics', exact: true })).toHaveCount(0);
  await openViewer(page, 'Split Screen', '?diagnostics=1&private_query=PRIVATE_URL_MARKER');
  await page
    .getByTestId('file-input')
    .setInputFiles([imageFile('PRIVATE_FILENAME_MARKER.png'), imageFile('second.png', 1)]);
  await page.getByLabel('Label for image A').fill('PRIVATE_LABEL_MARKER');
  await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
  await page.getByLabel('Game title').fill('PRIVATE_METADATA_MARKER');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('private-key', 'PRIVATE_STORAGE_MARKER'));
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await start(page);
  const box = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.move(box.x + 70, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 150, { steps: 4 });
  await page.mouse.up();
  await page
    .getByTestId('stage')
    .dispatchEvent('wheel', { deltaY: -100, clientX: box.x + 90, clientY: box.y + 140 });
  await page.getByTestId('stage').dispatchEvent('dblclick');
  await page.evaluate(() => visualViewport!.dispatchEvent(new Event('resize')));
  await stop(page);
  const data = await exported(page),
    serialized = JSON.stringify(data);
  expect(data.format).toBe('upscale-compare-gesture-log');
  expect(data.limits.truncated).toBe(false);
  for (const marker of ['PRIVATE_', 'blob:', 'data:image', 'localhost:', '127.0.0.1:'])
    expect(serialized).not.toContain(marker);
  for (const type of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'gotpointercapture',
    'lostpointercapture',
    'wheel',
    'dblclick',
  ])
    expect(
      data.entries.some((entry: any) => entry.kind === 'native' && entry.data.type === type),
    ).toBe(true);
  expect(data.entries.some((entry: any) => entry.kind === 'visual-viewport')).toBe(true);
  expect(
    data.entries.some(
      (entry: any) => entry.kind === 'calculation' && entry.data.source === 'wheel',
    ),
  ).toBe(true);
  expect(data.final.frame.renderedStyles).toHaveLength(2);
  expect(data.final.frame.scale).toBeGreaterThan(0);
  expect(data.final.activePointers).toEqual([]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = () => false;
  });
  await page.getByRole('button', { name: 'Copy log', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Select the log');
  const textarea = page.getByLabel('Diagnostic log JSON');
  await expect(textarea).toBeVisible();
  expect(JSON.parse(await textarea.inputValue()).format).toBe(data.format);
  expect(
    await textarea.evaluate(
      (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
    ),
  ).toBeGreaterThan(100);
  expect(requests).toEqual([]);
});

test('recording does not change pinch/pan results and correlates calculations with native events', async ({
  page,
}) => {
  for (const mode of ['Split Screen', 'Side-by-Side']) {
    const results = [];
    for (const enabled of [false, true]) {
      const box = await openViewer(page, mode, enabled ? '?diagnostics=1' : '');
      if (enabled) await start(page);
      const a = { x: box.x + 65, y: box.y + 120 },
        b = { x: a.x, y: a.y + 80 };
      await points(page, 'pointerdown', [
        [1000, a],
        [1001, b],
      ]);
      await points(page, 'pointermove', [
        [1000, { ...a, y: a.y - 20 }],
        [1001, { ...b, y: b.y + 20 }],
      ]);
      await expect
        .poll(async () => Number(await page.getByTestId('stage').getAttribute('data-zoom')))
        .toBeCloseTo(1.5, 6);
      await points(page, 'pointerup', [
        [1000, a],
        [1001, b],
      ]);
      results.push({
        zoom: await page.getByTestId('stage').getAttribute('data-zoom'),
        a: await page.getByTestId('image-A').boundingBox(),
        b: await page.getByTestId('image-B').boundingBox(),
      });
      if (enabled) {
        await stop(page);
        const data = await exported(page);
        const nativeIds = new Set(
          data.entries
            .filter((entry: any) => entry.kind === 'native')
            .map((entry: any) => entry.data.eventId),
        );
        const calculations = data.entries.filter(
          (entry: any) => entry.kind === 'calculation' && entry.data.source === 'pinch',
        );
        expect(calculations.length).toBeGreaterThan(0);
        for (const entry of calculations) {
          expect(nativeIds.has(entry.data.eventId)).toBe(true);
          expect(entry.data.ratio).toBeCloseTo(entry.data.distance / entry.data.oldDistance, 10);
        }
      }
    }
    expect(results[1]).toEqual(results[0]);
  }
});

test('native touch recording includes touch contacts, capture, cancellation and committed geometry', async ({
  page,
}) => {
  await openViewer(page, 'Split Screen', '?diagnostics=1');
  await start(page);
  const box = (await page.getByTestId('stage').boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const x = Math.round(box.x + 65),
    y = Math.round(box.y + 160);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x, y, id: 1 },
      { x, y: y + 80, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x, y: y - 20, id: 1 },
      { x, y: y + 100, id: 2 },
    ],
  });
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1.5');
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await stop(page);
  const data = await exported(page);
  expect(
    data.entries.some(
      (entry: any) =>
        entry.kind === 'native' &&
        entry.data.type === 'touchmove' &&
        entry.data.touches.length === 2,
    ),
  ).toBe(true);
  expect(
    data.entries.some(
      (entry: any) => entry.kind === 'native' && entry.data.type === 'pointercancel',
    ),
  ).toBe(true);
  expect(
    data.entries.some((entry: any) => entry.kind === 'native' && entry.data.eventCapture?.stage),
  ).toBe(true);
  expect(
    data.entries.some((entry: any) => entry.kind === 'commit' && entry.data.view.zoom === 1.5),
  ).toBe(true);
  expect(data.final.activePointers).toEqual([]);
  await client.detach();
});
