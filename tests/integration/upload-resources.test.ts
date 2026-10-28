import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureTestCostControls, migrateTestDatabase } from '../fixtures/database';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { emptyImageMetadata, emptyMetadata } from '../../shared/model';
import { crc32, MAX_IMAGE_CHUNKS } from '../../worker/src/image-validation';
import { pngChunk, rasterPng } from '../fixtures/png';
import { testPublicationHeaders } from '../fixtures/publication';

let mf: Miniflare;
const origin = 'http://localhost:5173';
const tiny = rasterPng(32, 24);
function form(images: Uint8Array[] = [tiny, tiny]) {
  const data = new FormData();
  data.set(
    'manifest',
    JSON.stringify({
      metadata: emptyMetadata(),
      config: {
        mode: 'split',
        selected: [0, 1],
        divider: 0.3,
        view: { zoom: 1, center: { x: 16, y: 12 } },
      },
      images: images.map((_, index) => ({
        label: 'Image ' + index,
        metadata: emptyImageMetadata(),
      })),
    }),
  );
  data.set('challenge', '');
  for (const image of images)
    data.append('images', new File([image as BlobPart], 'screenshot.png', { type: 'image/png' }));
  return data;
}
async function publish(data = form()) {
  const req = new Request('http://localhost/api/comparisons', {
    method: 'POST',
    headers: { Origin: origin, ...testPublicationHeaders() },
    body: data,
  });
  return mf.dispatchFetch(req.url, {
    method: req.method,
    headers: Object.fromEntries(req.headers),
    body: await req.arrayBuffer(),
  });
}
async function expectEmpty() {
  expect(
    await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT used_bytes, comparisons FROM quota')
      .first(),
  ).toEqual({ used_bytes: 0, comparisons: 0 });
  expect((await (await mf.getR2Bucket('IMAGES')).list()).objects).toHaveLength(0);
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'worker/dist/index.js',
      compatibilityDate: '2026-07-01',
      d1Databases: ['DB'],
      r2Buckets: ['IMAGES'],
      bindings: {
        ENVIRONMENT: 'development',
        UPLOADS_ENABLED: 'true',
        ALLOWED_ORIGINS: origin,
        FRONTEND_URL: origin,
        MAX_STORAGE_BYTES: String(128 * 1024 * 1024),
        MAX_COMPARISONS: '10',
        PUBLISHES_PER_HOUR: '100',
        // Intentionally excessive settings must not raise the hard resource ceilings.
        MAX_FILE_BYTES: '1000000000',
        MAX_TOTAL_BYTES: '1000000000',
        MAX_DIMENSION: '1000000000',
        MAX_PIXELS: '1000000000',
      },
    }),
  );
  await migrateTestDatabase(await mf.getD1Database('DB'));
});
beforeEach(async () => {
  await configureTestCostControls(await mf.getD1Database('DB'));
  await (
    await mf.getD1Database('DB')
  ).exec(
    'DELETE FROM comparisons; DELETE FROM rate_limits; UPDATE quota SET used_bytes = 0, comparisons = 0;',
  );
  const bucket = await mf.getR2Bucket('IMAGES');
  const objects = (await bucket.list()).objects;
  if (objects.length) await bucket.delete(objects.map((object) => object.key));
});
afterAll(async () => {
  await mf?.dispose();
});

describe('upload resource limits in workerd with local D1/R2', () => {
  it('rejects excessive PNG structure before reserving or storing anything', async () => {
    const attack = Buffer.concat([
      tiny.subarray(0, 33),
      ...Array(MAX_IMAGE_CHUNKS).fill(pngChunk('IDAT')),
      tiny.subarray(33),
    ]);
    const response = await publish(form([attack, tiny]));
    expect(response.status).toBe(415);
    expect(await response.text()).toContain('too many chunks');
    await expectEmpty();
    expect((await publish()).status).toBe(201); // Failed validation releases admission.
  });
  it('rejects excessive multipart structure without writes to quota or R2', async () => {
    const data = form();
    data.append('manifest', '{}');
    expect((await publish(data)).status).toBe(400);
    await expectEmpty();
  });
  it('does not raise the per-file ceiling through environment overrides', async () => {
    const response = await publish(form([new Uint8Array(20 * 1024 * 1024 + 1), tiny]));
    expect(response.status).toBe(413);
    await expectEmpty();
  });
  it.each([
    [10000, 10000],
    [16385, 1],
  ])(
    'does not raise image dimensions through environment overrides (%i × %i)',
    async (width, height) => {
      const image = Buffer.from(tiny);
      image.writeUInt32BE(width, 16);
      image.writeUInt32BE(height, 20);
      image.writeUInt32BE(crc32(image.subarray(12, 29)), 29);
      const response = await publish(form([image, tiny]));
      expect(response.status).toBe(415);
      expect(await response.text()).toContain('dimensions');
      await expectEmpty();
    },
  );
  it('preserves two 20 MiB originals in a complete 40 MiB publication', async () => {
    const size = 20 * 1024 * 1024;
    const metadata = Buffer.alloc(size - tiny.length - 12);
    metadata.write('Comment\0');
    const image = Buffer.concat([
      tiny.subarray(0, 33),
      pngChunk('tEXt', metadata),
      tiny.subarray(33),
    ]);
    expect(image.length).toBe(size);
    const response = await publish(form([image, image]));
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    for (const index of [0, 1]) {
      const original = await mf.dispatchFetch(
        'http://localhost/api/comparisons/' + id + '/images/' + index,
      );
      expect(original.status).toBe(200);
      expect(Buffer.from(await original.arrayBuffer()).equals(image)).toBe(true);
    }
    expect(
      await (
        await mf.getD1Database('DB')
      )
        .prepare('SELECT used_bytes, comparisons FROM quota')
        .first(),
    ).toEqual({ used_bytes: size * 2, comparisons: 1 });
  }, 30000);
  it('accepts four images and concurrent publications with their bytes intact', async () => {
    const results = await Promise.all([
      publish(form([tiny, tiny, tiny, tiny])),
      publish(),
      publish(),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201, 201]);
    const { id } = (await results[0].json()) as { id: string };
    for (let i = 0; i < 4; i++) {
      const image = await mf.dispatchFetch(
        'http://localhost/api/comparisons/' + id + '/images/' + i,
      );
      expect(Buffer.from(await image.arrayBuffer()).equals(tiny)).toBe(true);
    }
  });
});
