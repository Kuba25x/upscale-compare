import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { Config, Manifest, PublicComparison } from '../../shared/model';
import { browserFile, original, type Original } from '../fixtures/fidelity';
import { imageFile } from '../e2e/fixtures';
import { test, expect, openShare, publishButton, solve, settings } from './fixtures';

const scenarios = [
  {
    name: 'mixed PNG/JPEG/lossy WebP',
    names: ['rgba-metadata.png', 'baseline.jpg', 'lossy.webp'],
    mode: 'split',
    zoom: 2.5,
  },
  {
    name: 'indexed/16-bit PNG and lossless WebP/progressive JPEG',
    names: ['indexed-alpha.png', 'rgb16.png', 'lossless-alpha.webp', 'progressive.jpg'],
    mode: 'side',
    zoom: null,
  },
  {
    name: '4K and mismatched PNG sizes',
    names: ['uhd.png', 'rgba-metadata.png'],
    mode: 'split',
    zoom: 1,
  },
] as const;

async function fingerprints(page: Page, urls?: string[]) {
  return page.evaluate(async (urls) => {
    const digest = async (data: ArrayBuffer) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    const blobs = urls
      ? await Promise.all(
          urls.map(async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Original download failed');
            return response.blob();
          }),
        )
      : [...(document.querySelector<HTMLInputElement>('[data-testid=file-input]')!.files || [])];
    return Promise.all(
      blobs.map(async (blob) => {
        const url = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return {
            bytes: await digest(await blob.arrayBuffer()),
            pixels: await digest(
              context.getImageData(0, 0, canvas.width, canvas.height).data.buffer,
            ),
            width: image.naturalWidth,
            height: image.naturalHeight,
            type: blob.type,
            size: blob.size,
          };
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
  }, urls);
}
async function publishSnapshot(page: Page) {
  await openShare(page);
  await solve(page);
  await page.getByRole('checkbox').check();
  const sent = page.waitForRequest(
    (request) => request.url().endsWith('/api/comparisons') && request.method() === 'POST',
  );
  await publishButton(page).click();
  const request = await sent;
  const form = await new Request(request.url(), {
    method: 'POST',
    headers: { 'Content-Type': request.headers()['content-type'] },
    body: new Uint8Array(request.postDataBuffer()!),
  }).formData();
  const snapshot = JSON.parse(String(form.get('manifest'))) as Manifest;
  await expect(page.getByLabel('Public comparison link')).toBeVisible();
  return { snapshot, url: await page.getByLabel('Public comparison link').inputValue() };
}
async function publicManifest(page: Page, id: string) {
  const response = await page.request.get(`${settings.apiOrigin}/api/comparisons/${id}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<PublicComparison>;
}
async function assertGeometry(page: Page, config: Config, files: Original[]) {
  await expect(page.getByTestId('stage')).toHaveAttribute(
    'data-zoom',
    String(config.view.zoom ?? 'fit'),
  );
  await expect(page.getByLabel('Select image A')).toHaveValue(String(config.selected[0]));
  await expect(page.getByLabel('Select image B')).toHaveValue(String(config.selected[1]));
  await expect(
    page.getByRole('button', {
      name: config.mode === 'side' ? 'Side-by-Side' : 'Split Screen',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  if (config.mode === 'split')
    await expect(page.getByRole('slider')).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(config.divider * 100)),
    );
  await expect
    .poll(async () => {
      const stage = await page.getByTestId('stage').boundingBox();
      return stage?.width || 0;
    })
    .toBeGreaterThan(100);
  const ratio = await page.evaluate(() => devicePixelRatio);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const panelWidth = config.mode === 'side' ? (stage.width - 1) / 2 : stage.width;
  const selected = config.selected.map((index) => files[index]);
  const expectedScale =
    config.view.zoom === null
      ? Math.min(
          panelWidth / Math.max(...selected.map((file) => file.width)),
          stage.height / Math.max(...selected.map((file) => file.height)),
        )
      : config.view.zoom / ratio;
  for (const [index, side] of ['A', 'B'].entries()) {
    const image = page.getByTestId(`image-${side}`);
    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBeCloseTo(selected[index].width * expectedScale, 1);
    const bounds = (await image.boundingBox())!;
    expect(bounds.height).toBeCloseTo(selected[index].height * expectedScale, 1);
    const panelOffset = config.mode === 'side' && index === 1 ? panelWidth + 1 : 0;
    // Integer zoom snaps the global origin by at most half a physical pixel.
    const tolerance =
      0.05 / expectedScale +
      (config.view.zoom !== null && Number.isInteger(config.view.zoom)
        ? 0.5 / (expectedScale * ratio)
        : 0);
    const center = {
      x: (stage.x + panelOffset + panelWidth / 2 - bounds.x) / expectedScale,
      y: (stage.y + stage.height / 2 - bounds.y) / expectedScale,
    };
    expect(Math.abs(center.x - config.view.center.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(center.y - config.view.center.y)).toBeLessThanOrEqual(tolerance);
  }
}

for (const scenario of scenarios) {
  test(`restores publication snapshot and original files: ${scenario.name}`, async ({ page }) => {
    const files = scenario.names.map(original);
    const requests: { method: string; path: string }[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(settings.apiOrigin))
        requests.push({ method: request.method(), path: new URL(request.url()).pathname });
    });
    await page.goto('./');
    await page.getByTestId('file-input').setInputFiles(files.map(browserFile));
    await expect(page.getByTestId('stage')).toBeVisible();
    const local = await fingerprints(page);
    local.forEach((result, i) => {
      expect(result.bytes).toBe(files[i].sha256);
      expect(result.width).toBe(files[i].width);
      expect(result.height).toBe(files[i].height);
    });
    for (let i = 0; i < files.length; i++) {
      await page.getByLabel('Select image A').selectOption(String(i));
      await page.getByLabel('Label for image A', { exact: true }).fill(`Source ${i + 1} — żółć 🎮`);
    }
    await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
    await page.getByLabel('Game title', { exact: true }).fill('Generated comparison — α');
    await page.getByLabel('GPU / hardware', { exact: true }).fill('Test GPU <A&B>');
    await page
      .getByRole('textbox', { name: 'Graphics settings', exact: true })
      .fill('Line one\nLine two\twith tab');
    await page
      .getByLabel('Description', { exact: true })
      .fill('Originals retain their embedded metadata.');
    for (let i = 0; i < files.length; i++) {
      await page.getByLabel('Upscaling technology', { exact: true }).nth(i).fill(`Technology ${i}`);
      await page.getByLabel('Quality preset', { exact: true }).nth(i).fill(`Preset ${i}`);
      await page
        .getByLabel('Rendering resolution', { exact: true })
        .nth(i)
        .fill(`${files[i].width} × ${files[i].height}`);
    }
    await page.getByRole('button', { name: 'Save details', exact: true }).click();
    await page.getByLabel('Select image A').selectOption(String(files.length - 1));
    await page.getByLabel('Select image B').selectOption('0');
    const divider = page.getByRole('slider');
    await divider.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
    if (scenario.mode === 'side')
      await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
    if (scenario.zoom === null)
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
    else {
      await page
        .getByRole('button', { name: scenario.zoom === 1 ? '100%' : '200%', exact: true })
        .click();
      if (scenario.zoom === 2.5)
        await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    }
    const stage = (await page.getByTestId('stage').boundingBox())!;
    const point = { x: stage.x + stage.width * 0.25, y: stage.y + stage.height * 0.45 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 19, point.y - 11, { steps: 3 });
    await page.mouse.up();
    const { snapshot, url } = await publishSnapshot(page);
    expect(snapshot.config.mode).toBe(scenario.mode);
    expect(snapshot.config.view.zoom).toBe(scenario.zoom);
    expect(snapshot.config.selected).toEqual([files.length - 1, 0]);
    expect(snapshot.config.divider).toBeCloseTo(0.37, 12);
    expect(snapshot.metadata).toEqual({
      game: 'Generated comparison — α',
      gpu: 'Test GPU <A&B>',
      settings: 'Line one\nLine two\twith tab',
      description: 'Originals retain their embedded metadata.',
    });
    expect(snapshot.images.map((image) => image.metadata)).toEqual(
      files.map((file, i) => ({
        technology: `Technology ${i}`,
        preset: `Preset ${i}`,
        renderingResolution: `${file.width} × ${file.height}`,
      })),
    );
    const selected = [files[files.length - 1], files[0]];
    expect(snapshot.config.view.center).not.toEqual({
      x: Math.max(...selected.map((file) => file.width)) / 2,
      y: Math.max(...selected.map((file) => file.height)) / 2,
    });
    expect(snapshot.images.map((image) => image.label)).toEqual(
      files.map((_, i) => `Source ${i + 1} — żółć 🎮`),
    );
    const id = url.split('/').pop()!;
    const stored = await publicManifest(page, id);
    expect(stored.config).toEqual(snapshot.config);
    expect(stored.metadata).toEqual(snapshot.metadata);
    expect(stored.images.map(({ label, metadata }) => ({ label, metadata }))).toEqual(
      snapshot.images,
    );
    // Visit with no saved owner capability. No local File objects survive navigation.
    await page.evaluate(() => localStorage.clear());
    await page.goto(url);
    await expect(page).toHaveURL(new RegExp('/upscale-compare/#c/' + id + '$'));
    await expect(page.getByTestId('stage')).toBeVisible();
    await assertGeometry(page, snapshot.config, files);
    for (const [slot, side] of ['A', 'B'].entries()) {
      await expect(page.getByTestId(`image-${side}`)).toHaveAttribute(
        'alt',
        snapshot.images[snapshot.config.selected[slot]].label,
      );
    }
    expect(
      await fingerprints(
        page,
        files.map((_, i) => `${settings.apiOrigin}/api/comparisons/${id}/images/${i}`),
      ),
    ).toEqual(local);
    await expect(page.getByLabel('Label for image A', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Comparison details', exact: true }).click();
    await expect(page.getByLabel('Game title', { exact: true })).toHaveValue(
      snapshot.metadata.game,
    );
    await expect(page.getByLabel('GPU / hardware', { exact: true })).toHaveValue(
      snapshot.metadata.gpu,
    );
    await expect(page.getByRole('textbox', { name: 'Graphics settings', exact: true })).toHaveValue(
      snapshot.metadata.settings,
    );
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
      snapshot.metadata.description,
    );
    for (let i = 0; i < files.length; i++) {
      await expect(page.getByLabel('Upscaling technology', { exact: true }).nth(i)).toHaveValue(
        snapshot.images[i].metadata.technology,
      );
      await expect(page.getByLabel('Quality preset', { exact: true }).nth(i)).toHaveValue(
        snapshot.images[i].metadata.preset,
      );
      await expect(page.getByLabel('Rendering resolution', { exact: true }).nth(i)).toHaveValue(
        snapshot.images[i].metadata.renderingResolution,
      );
      await expect(page.getByLabel('Upscaling technology', { exact: true }).nth(i)).toBeDisabled();
    }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Swap images', exact: true }).click();
    await page.getByRole('button', { name: '400%', exact: true }).click();
    await page
      .getByRole('button', {
        name: scenario.mode === 'side' ? 'Split Screen' : 'Side-by-Side',
        exact: true,
      })
      .click();
    if (scenario.mode === 'side')
      await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '37');
    expect(await publicManifest(page, id)).toEqual(stored);
    await page.reload();
    await expect(page.getByTestId('stage')).toBeVisible();
    await assertGeometry(page, snapshot.config, files);
    expect(requests.filter(({ method }) => method === 'POST')).toEqual([
      { method: 'POST', path: '/api/publications/result' },
      { method: 'POST', path: '/api/comparisons' },
    ]);
    expect(requests.every(({ method }) => ['POST', 'GET', 'OPTIONS'].includes(method))).toBe(true);
  });
}

test('restores original pixels at 100% source zoom in both public panels', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('Reference.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.getByRole('button', { name: 'Side-by-Side', exact: true }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  const { url } = await publishSnapshot(page);
  await page.goto(url);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-zoom', '1');
  const ratio = await page.evaluate(() => devicePixelRatio);
  for (const side of ['A', 'B']) {
    const image = page.getByTestId(`image-${side}`);
    await expect.poll(async () => (await image.boundingBox())!.width * ratio).toBeCloseTo(640, 1);
  }
  await page.mouse.move(0, 0);
  const shot = PNG.sync.read(await page.screenshot());
  for (const side of ['A', 'B']) {
    const bounds = (await page.getByTestId(`image-${side}`).boundingBox())!;
    for (const [x, y] of [
      [300, 200],
      [320, 240],
      [340, 280],
    ]) {
      const screenX = Math.round(bounds.x * ratio) + x;
      const screenY = Math.round(bounds.y * ratio) + y;
      const offset = (screenY * shot.width + screenX) * 4;
      expect([...shot.data.subarray(offset, offset + 4)]).toEqual(
        side === 'A' ? [x % 256, y % 256, 80, 255] : [180, y % 256, x % 256, 255],
      );
    }
  }
});

test('refuses partial restoration when a published original is missing', async ({
  page,
  sharing,
}) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles([imageFile(), imageFile('Reference.png', 1)]);
  await expect(page.getByTestId('stage')).toBeVisible();
  const { url } = await publishSnapshot(page);
  const id = url.split('/').pop()!;
  await (await sharing.mf.getR2Bucket('IMAGES')).delete(`comparisons/${id}/1`);
  await page.goto(url);
  await expect(page.getByRole('alert')).toContainText(/decoded|loaded|unavailable/i);
  await expect(page.getByTestId('stage')).toHaveCount(0);
  expect(sharing.verification.requests).toHaveLength(1);
});
