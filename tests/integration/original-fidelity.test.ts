import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { type Config, type Manifest, type PublicComparison } from '../../shared/model';
import { testPublicationHeaders } from '../fixtures/publication';
import { configureTestCostControls, migrateTestDatabase } from '../fixtures/database';
import { LOCAL_VERIFICATION_SECRET, VerificationService } from '../fixtures/verification';
import { digest, originals, original, withOrientation, type Original } from '../fixtures/fidelity';

const origin = 'http://localhost:4176';
const verification = new VerificationService('localhost');
let mf: Miniflare;
const configuration: Config = {
  mode: 'side',
  selected: [1, 0],
  divider: 0.37123456789,
  view: { zoom: 1.25, center: { x: -12.125, y: 432.875 } },
};
function manifest(files: Original[], config = configuration): Manifest {
  return {
    metadata: {
      game: 'Generated screenshots — żółć 🎮',
      gpu: 'Test GPU <A&B>',
      settings: 'Line one\nLine two\twith tab',
      description: 'Original file metadata is public.',
    },
    config,
    images: files.map((file, i) => ({
      label: `${i + 1} · ${file.name} — α`,
      metadata: {
        technology: `Technique ${i}`,
        preset: `Preset ${i}`,
        renderingResolution: `${file.width} × ${file.height}`,
      },
    })),
  };
}
async function upload(files: Original[], data = manifest(files)) {
  const body = new FormData();
  body.set('manifest', JSON.stringify(data));
  body.set('challenge', `valid-${crypto.randomUUID()}`);
  files.forEach((file, i) =>
    body.append(
      'images',
      new File([file.buffer], `private-original-${i}.wrong-extension`, { type: file.type }),
    ),
  );
  const request = new Request('http://localhost/api/comparisons', {
    method: 'POST',
    headers: { Origin: origin, ...testPublicationHeaders() },
    body,
  });
  return mf.dispatchFetch(request.url, {
    method: 'POST',
    headers: Object.fromEntries(request.headers),
    body: await request.arrayBuffer(),
  });
}
async function read(id: string) {
  const response = await mf.dispatchFetch(`http://localhost/api/comparisons/${id}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<PublicComparison>;
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
        ENVIRONMENT: 'production',
        UPLOADS_ENABLED: 'true',
        ALLOWED_ORIGINS: origin,
        FRONTEND_URL: origin + '/upscale-compare/',
        TURNSTILE_SECRET: LOCAL_VERIFICATION_SECRET,
        PUBLISHES_PER_HOUR: '100',
      },
      outboundService: verification.fetch,
    }),
  );
  await migrateTestDatabase(await mf.getD1Database('DB'));
});
beforeEach(async () => {
  verification.reset();
  const db = await mf.getD1Database('DB');
  await configureTestCostControls(db);
  await db.exec(
    'DELETE FROM comparisons; DELETE FROM publication_requests; DELETE FROM rate_limits; UPDATE quota SET used_bytes = 0, comparisons = 0;',
  );
  const bucket = await mf.getR2Bucket('IMAGES');
  const objects = (await bucket.list()).objects;
  if (objects.length) await bucket.delete(objects.map((object) => object.key));
});
afterAll(async () => {
  await mf?.dispose();
});

it.each(originals)('preserves the exact original, metadata and headers: $name', async (file) => {
  expect(file.buffer.length).toBe(file.size);
  expect(digest(file.buffer)).toBe(file.sha256);
  const files = [file, original('rgba-metadata.png')];
  const data = manifest(files);
  const response = await upload(files, data);
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const comparison = await read(id);
  expect(comparison.metadata).toEqual(data.metadata);
  expect(comparison.config).toEqual(data.config);
  const bucket = await mf.getR2Bucket('IMAGES');
  for (const [i, source] of files.entries()) {
    const extension = source.type === 'image/jpeg' ? 'jpg' : source.type.split('/')[1];
    expect(comparison.images[i]).toEqual({
      ...data.images[i],
      width: source.width,
      height: source.height,
      type: source.type,
      size: source.size,
      name: `screenshot-${i + 1}.${extension}`,
    });
    const stored = await bucket.get(`comparisons/${id}/${i}`);
    expect(stored).not.toBeNull();
    expect(digest(new Uint8Array(await stored!.arrayBuffer()))).toBe(source.sha256);
    const url = `http://localhost/api/comparisons/${id}/images/${i}`;
    for (const method of ['GET', 'HEAD']) {
      const result = await mf.dispatchFetch(url, { method, headers: { Origin: origin } });
      expect(result.status).toBe(200);
      expect(result.headers.get('Content-Type')).toBe(source.type);
      expect(result.headers.get('Content-Length')).toBe(String(source.size));
      expect(result.headers.get('Content-Disposition')).toBe(
        `inline; filename="screenshot-${i + 1}.${extension}"`,
      );
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const bytes = Buffer.from(await result.arrayBuffer());
      if (method === 'HEAD') expect(bytes.length).toBe(0);
      else {
        expect(digest(bytes)).toBe(source.sha256);
        expect(bytes.equals(source.buffer)).toBe(true);
      }
    }
  }
  expect(
    await (
      await mf.getD1Database('DB')
    )
      .prepare('SELECT used_bytes, comparisons FROM quota')
      .first(),
  ).toEqual({
    used_bytes: files.reduce((sum, file) => sum + file.size, 0),
    comparisons: 1,
  });
});

it.each([2, 3, 4])(
  'retains order, distinct labels and image metadata for %i mixed-format originals',
  async (count) => {
    const files = ['rgba-metadata.png', 'baseline.jpg', 'lossless-alpha.webp', 'rgb16.png']
      .slice(0, count)
      .map(original);
    const data = manifest(files, { ...configuration, selected: [count - 1, 0] });
    const response = await upload(files, data);
    expect(response.status).toBe(201);
    const comparison = await read(((await response.json()) as { id: string }).id);
    expect(comparison.config).toEqual(data.config);
    expect(comparison.images.map(({ label, metadata }) => ({ label, metadata }))).toEqual(
      data.images,
    );
    for (const [i, file] of files.entries()) {
      const response = await mf.dispatchFetch(
        `http://localhost/api/comparisons/${comparison.id}/images/${i}`,
      );
      expect(digest(new Uint8Array(await response.arrayBuffer()))).toBe(file.sha256);
    }
  },
);

const configurations: Config[] = (['split', 'side'] as const).flatMap((mode) =>
  [null, 0.025, 1, 1.25, 2, 16].map((zoom) => ({
    mode,
    selected: [3, 1] as [number, number],
    divider: mode === 'split' ? 0 : 1,
    view: { zoom, center: { x: -12.125, y: 432.875 } },
  })),
);
it.each(configurations)(
  'restores mode $mode and zoom $view.zoom without quantizing the source center',
  async (config) => {
    const files = originals.slice(0, 4);
    const response = await upload(files, manifest(files, config));
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect((await read(id)).config).toEqual(config);
    expect((await read(id)).config).toEqual(config);
  },
);

const rotated = [
  ...[2, 3, 4, 5, 6, 7, 8].map((orientation) => ({ name: 'baseline.jpg', orientation })),
  { name: 'rgba-metadata.png', orientation: 6 },
  { name: 'lossy.webp', orientation: 2 },
];
it.each(rotated)(
  'rejects orientation $orientation in $name without altering files or reserving storage',
  async ({ name, orientation }) => {
    const file = original(name);
    const transformed = { ...file, buffer: withOrientation(file, orientation) };
    const response = await upload([transformed, original('rgb16.png')]);
    expect(response.status).toBe(415);
    expect(await response.text()).toContain('orientation-normalized');
    const db = await mf.getD1Database('DB');
    expect((await db.prepare('SELECT * FROM comparisons').all()).results).toHaveLength(0);
    expect((await db.prepare('SELECT * FROM publication_requests').all()).results).toHaveLength(0);
    expect(await db.prepare('SELECT used_bytes, comparisons FROM quota').first()).toEqual({
      used_bytes: 0,
      comparisons: 0,
    });
    expect((await (await mf.getR2Bucket('IMAGES')).list()).objects).toHaveLength(0);
  },
);
