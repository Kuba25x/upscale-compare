import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker, { type Env } from '../../worker/src/index';
import { sweepComparisons, saveComparison, type Storage } from '../../worker/src/publication-store';
import { emptyMetadata, emptyImageMetadata, type PublicComparison } from '../../shared/model';
import { instrumentStorage, type Hook } from '../fixtures/storage';
import { migrateTestDatabase, configureTestCostControls } from '../fixtures/database';
import { rasterPng } from '../fixtures/png';
import { testPublicationHeaders } from '../fixtures/publication';

let mf: Miniflare, storage: Storage;
let serial = 0;
const png = rasterPng(16, 12),
  origin = 'http://localhost:5173';
function metered(fault?: Hook) {
  const counts: Record<string, number> = {};
  const target = instrumentStorage(storage, async (op, sql, phase) => {
    if (phase === 'before') counts[op] = (counts[op] || 0) + 1;
    await fault?.(op, sql, phase);
  });
  return { target, counts, total: () => Object.values(counts).reduce((a, b) => a + b, 0) };
}
const env = (target: Storage) =>
  ({
    ...target,
    ENVIRONMENT: 'development',
    UPLOADS_ENABLED: 'true',
    ALLOWED_ORIGINS: origin,
    FRONTEND_URL: origin,
    PUBLISHES_PER_HOUR: '100',
  }) as Env;
function upload() {
  const form = new FormData();
  form.set(
    'manifest',
    JSON.stringify({
      metadata: emptyMetadata(),
      images: [0, 1, 2, 3].map((i) => ({ label: `Source ${i}`, metadata: emptyImageMetadata() })),
      config: {
        mode: 'side',
        selected: [3, 1],
        divider: 0.37,
        view: { zoom: 1.25, center: { x: 8, y: 6 } },
      },
    }),
  );
  for (let i = 0; i < 4; i++)
    form.append('images', new File([png], 'source.png', { type: 'image/png' }));
  return new Request('http://localhost/api/comparisons', {
    method: 'POST',
    headers: { Origin: origin, ...testPublicationHeaders() },
    body: form,
  });
}
async function seedDue() {
  const id = (++serial).toString(16).padStart(16, '0');
  const data: PublicComparison = {
    id,
    createdAt: new Date().toISOString(),
    metadata: { ...emptyMetadata(), game: 'private-manifest-marker' },
    config: {
      mode: 'side',
      selected: [0, 1],
      divider: 0.5,
      view: { zoom: null, center: { x: 8, y: 6 } },
    },
    images: [0, 1, 2, 3].map((i) => ({
      label: `Source ${i}`,
      metadata: emptyImageMetadata(),
      width: 16,
      height: 12,
      size: png.length,
      type: 'image/png',
      name: 'screenshot.png',
    })),
  };
  await saveComparison(
    storage,
    data,
    'private-capability-hash-marker',
    [0, 1, 2, 3].map(() => ({ bytes: new Uint8Array(png), type: 'image/png' })),
    { maxStorageBytes: 1e8, maxComparisons: 100 },
  );
  await storage.DB.prepare(
    "UPDATE comparisons SET status = 'deleting', cleanup_after = 0 WHERE id = ?",
  )
    .bind(id)
    .run();
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'worker/dist/index.js',
      compatibilityDate: '2026-07-01',
      d1Databases: ['DB'],
      r2Buckets: ['IMAGES'],
    }),
  );
  storage = {
    DB: await mf.getD1Database('DB'),
    IMAGES: await mf.getR2Bucket('IMAGES'),
  } as unknown as Storage;
  await migrateTestDatabase(storage.DB);
});
beforeEach(async () => {
  await configureTestCostControls(storage.DB);
  await storage.DB.exec(
    'DELETE FROM comparisons; DELETE FROM publication_requests; DELETE FROM rate_limits; UPDATE quota SET used_bytes = 0, comparisons = 0;',
  );
  const objects = (await storage.IMAGES.list()).objects;
  if (objects.length) await storage.IMAGES.delete(objects.map((object) => object.key));
});
afterAll(async () => {
  await mf?.dispose();
});
it('bounds expired rate-row deletion and preserves the cutoff and eventual progress', async () => {
  const now = Date.now(),
    cutoff = Math.floor(now / 1000);
  for (let start = 0; start < 250; start += 50)
    await storage.DB.batch(
      Array.from({ length: 50 }, (_, i) =>
        storage.DB.prepare('INSERT INTO rate_limits VALUES (?, 1, ?)').bind(
          `expired-${start + i}`,
          cutoff - 1,
        ),
      ),
    );
  await storage.DB.prepare('INSERT INTO rate_limits VALUES (?, 1, ?)')
    .bind('at-boundary', cutoff)
    .run();
  await sweepComparisons(storage, now);
  expect(
    await storage.DB.prepare('SELECT COUNT(*) AS n FROM rate_limits WHERE expires_at < ?')
      .bind(cutoff)
      .first(),
  ).toEqual({ n: 150 });
  await sweepComparisons(storage, now);
  expect(
    await storage.DB.prepare('SELECT COUNT(*) AS n FROM rate_limits WHERE expires_at < ?')
      .bind(cutoff)
      .first(),
  ).toEqual({ n: 50 });
  await sweepComparisons(storage, now);
  expect((await storage.DB.prepare('SELECT key FROM rate_limits').all()).results).toEqual([
    { key: 'at-boundary' },
  ]);
});
it.each(['success', 'put-failure', 'activation-ack-loss'])(
  'keeps a four-original publication below 50 binding calls with a verification reserve: %s',
  async (mode) => {
    const meter = metered((op, sql, phase) => {
      if (mode === 'put-failure' && op === 'put' && phase === 'after')
        throw new Error('Lost PUT ack');
      if (
        mode === 'activation-ack-loss' &&
        op === 'first' &&
        sql.includes("SET status = 'active'") &&
        phase === 'after'
      )
        throw new Error('Lost activation ack');
    });
    const response = await worker.fetch(upload(), env(meter.target));
    expect(response.status).toBe(mode === 'success' ? 201 : 503);
    await response.arrayBuffer();
    expect(meter.counts.put).toBe(mode === 'put-failure' ? 1 : 4);
    console.info(
      'Local binding count',
      JSON.stringify({ scenario: mode, calls: meter.total(), verificationReserve: 1 }),
    );
    expect(meter.total() + 1).toBeLessThanOrEqual(50); // production Siteverify: one non-redirecting fetch
  },
);
it.each(['success', 'delete-failure', 'batch-before-failure', 'batch-ack-loss'])(
  'keeps the full cleanup batch below 50 calls including retention and fault recovery: %s',
  async (mode) => {
    for (let i = 0; i < 12; i++) await seedDue();
    const meter = metered((op, _sql, phase) => {
      if (mode === 'delete-failure' && op === 'delete' && phase === 'before')
        throw new Error('R2 unavailable');
      if (mode === 'batch-before-failure' && op === 'batch' && phase === 'before')
        throw new Error('D1 unavailable');
      if (mode === 'batch-ack-loss' && op === 'batch' && phase === 'after')
        throw new Error('D1 acknowledgement lost');
    });
    if (mode === 'success') expect(await sweepComparisons(meter.target)).toEqual({ processed: 10 });
    else await expect(sweepComparisons(meter.target)).rejects.toThrow('failed operation');
    expect(meter.counts.delete).toBe(10);
    console.info(
      'Local cleanup binding count',
      JSON.stringify({ scenario: mode, calls: meter.total() }),
    );
    expect(meter.total()).toBeLessThanOrEqual(44);
    expect(meter.total()).toBeLessThan(50);
  },
);
it('continues comparison cleanup when rate retention fails', async () => {
  await seedDue();
  const meter = metered((op, sql, phase) => {
    if (op === 'run' && sql.startsWith('DELETE FROM rate_limits') && phase === 'before')
      throw new Error('Rate retention unavailable');
  });
  await expect(sweepComparisons(meter.target)).rejects.toThrow('failed operation');
  expect((await storage.DB.prepare('SELECT id FROM comparisons').all()).results).toEqual([]);
  expect((await storage.IMAGES.list()).objects).toEqual([]);
});
it('produces a read-only aggregate operations snapshot without manifests, credentials or network identifiers', async () => {
  await seedDue();
  const tables = [
    'comparisons',
    'quota',
    'rate_limits',
    'publication_requests',
    'service_control',
    'daily_usage',
  ];
  const snapshot = async () =>
    Promise.all(
      tables.map(
        async (table) => (await storage.DB.prepare('SELECT * FROM ' + table).all()).results,
      ),
    );
  const before = await snapshot();
  const sql = (await readFile('worker/operations-status.sql', 'utf8')).replace(/--[^\n]*/g, '');
  const results = [];
  for (const statement of sql
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    expect(statement).toMatch(/^SELECT /);
    results.push((await storage.DB.prepare(statement).all()).results);
  }
  expect(await snapshot()).toEqual(before);
  const json = JSON.stringify(results);
  for (const forbidden of [
    'private-manifest-marker',
    'private-capability-hash-marker',
    'payload',
    'delete_hash',
    'key_hash',
  ])
    expect(json).not.toContain(forbidden);
  expect(json).toContain('reserved_bytes');
  expect(json).toContain('expired_rate_rows');
});
