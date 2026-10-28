import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker, { type Env } from '../../worker/src/index';
import {
  admitImage,
  admitRead,
  admitUpload,
  readControl,
  stopPublishing,
  utcDay,
} from '../../worker/src/cost-controls';
import {
  eraseComparison,
  saveComparison,
  sweepComparisons,
  type ComparisonRow,
  type Storage,
} from '../../worker/src/publication-store';
import { emptyImageMetadata, emptyMetadata, type PublicComparison } from '../../shared/model';
import { PUBLICATION_RETRY_MS, publicationHeaders, randomHex } from '../../shared/publication';
import { configureTestCostControls, migrateTestDatabase } from '../fixtures/database';
import { instrumentStorage } from '../fixtures/storage';
import { testPublicationCredentials } from '../fixtures/publication';
import { rasterPng } from '../fixtures/png';

let mf: Miniflare, storage: Storage;
const origin = 'http://localhost:5173',
  png = rasterPng(16, 12);
const images = [0, 1].map(() => ({ bytes: new Uint8Array(png), type: 'image/png' }));
const metadata = () => ({
  metadata: emptyMetadata(),
  images: ['A', 'B'].map((label) => ({ label, metadata: emptyImageMetadata() })),
  config: {
    mode: 'split' as const,
    selected: [0, 1] as [number, number],
    divider: 0.5,
    view: { zoom: null, center: { x: 8, y: 6 } },
  },
});
const env = (target = storage, overrides: Partial<Env> = {}) =>
  ({
    ...target,
    ENVIRONMENT: 'development',
    UPLOADS_ENABLED: 'true',
    ALLOWED_ORIGINS: origin,
    FRONTEND_URL: origin,
    ADMIN_TOKEN: 'test-operator-key',
    ...overrides,
  }) as Env;
function uploadRequest() {
  const body = new FormData();
  body.set('manifest', JSON.stringify(metadata()));
  for (let i = 0; i < 2; i++)
    body.append('images', new File([png], 'original.png', { type: 'image/png' }));
  return new Request('http://localhost/api/comparisons', {
    method: 'POST',
    headers: { Origin: origin, ...publicationHeaders(testPublicationCredentials()) },
    body,
  });
}
const api = (path: string, init?: RequestInit, target = env()) =>
  worker.fetch(new Request('http://localhost' + path, init), target);
const policy = (sql: string) =>
  storage.DB.exec('UPDATE service_control SET ' + sql + ' WHERE id = 1;');
const usage = async (day = utcDay()) =>
  (await storage.DB.prepare('SELECT * FROM daily_usage WHERE day = ?')
    .bind(day)
    .first<Record<string, number>>()) || {};
const row = (id: string) =>
  storage.DB.prepare('SELECT * FROM comparisons WHERE id = ?').bind(id).first<ComparisonRow>();
const quota = () => storage.DB.prepare('SELECT used_bytes, comparisons FROM quota').first();
const objectCount = async () => (await storage.IMAGES.list()).objects.length;
async function save(target = storage, generation?: number) {
  const id = randomHex(8),
    data = metadata();
  const payload: PublicComparison = {
    ...data,
    id,
    createdAt: new Date().toISOString(),
    images: data.images.map((image) => ({
      ...image,
      width: 16,
      height: 12,
      size: png.length,
      type: 'image/png',
      name: 'screenshot.png',
    })),
  };
  return saveComparison(
    target,
    payload,
    'ab'.repeat(32),
    images,
    { maxStorageBytes: 1e9, maxComparisons: 100 },
    {
      keyHash: randomHex(32),
      digest: 'ab'.repeat(32),
      requestHash: randomHex(32),
      expiresAt: Date.now() + PUBLICATION_RETRY_MS,
    },
    generation,
  );
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'worker/dist/index.js',
      compatibilityDate: '2026-07-01',
      d1Databases: ['DB', 'BOOT'],
      r2Buckets: ['IMAGES'],
    }),
  );
  storage = {
    DB: await mf.getD1Database('DB'),
    IMAGES: await mf.getR2Bucket('IMAGES'),
  } as unknown as Storage;
  await migrateTestDatabase(storage.DB);
  await migrateTestDatabase(await mf.getD1Database('BOOT'));
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

describe('global daily budgets', () => {
  it('starts closed with zero limits and no active/retained state changes', async () => {
    const boot = await mf.getD1Database('BOOT');
    const target = env({ ...storage, DB: boot as unknown as Storage['DB'] });
    expect(await (await api('/api/health', undefined, target)).json()).toMatchObject({
      uploadsEnabled: false,
    });
    expect((await worker.fetch(uploadRequest(), target)).status).toBe(503);
    expect((await api('/api/comparisons/' + 'a'.repeat(16), undefined, target)).status).toBe(503);
    expect(await boot.prepare('SELECT COUNT(*) AS n FROM daily_usage').first()).toEqual({ n: 0 });
  });
  it.each(['max_upload_attempts', 'max_upload_bytes', 'max_publications', 'max_publication_bytes'])(
    'treats zero %s as disabled, not a fallback',
    async (field) => {
      await policy(field + ' = 0');
      expect((await worker.fetch(uploadRequest(), env())).status).toBe(503);
      expect(await usage()).toEqual({});
      expect(await objectCount()).toBe(0);
    },
  );
  it.each([-1, 1.5, 'unlimited', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid policy values: %s',
    async (value) => {
      await expect(
        storage.DB.prepare('UPDATE service_control SET max_upload_bytes = ?').bind(value).run(),
      ).rejects.toThrow('CHECK constraint');
    },
  );
  it('atomically admits only the shared count limit across concurrent callers', async () => {
    await policy('max_upload_attempts = 3');
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () => admitUpload(storage.DB, 100)),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(await usage()).toMatchObject({ upload_attempts: 3, upload_bytes: 300 });
  });
  it('atomically enforces byte ceilings and resets only at a new UTC day', async () => {
    await policy('max_upload_bytes = 200');
    const first = Date.parse('2026-10-28T23:59:59.999Z'),
      next = first + 1;
    await admitUpload(storage.DB, 100, first);
    await admitUpload(storage.DB, 100, first);
    await expect(admitUpload(storage.DB, 1, first)).rejects.toMatchObject({ status: 503 });
    await admitUpload(storage.DB, 200, next);
    expect(await usage('2026-10-28')).toMatchObject({ upload_attempts: 2, upload_bytes: 200 });
    expect(await usage('2026-10-29')).toMatchObject({ upload_attempts: 1, upload_bytes: 200 });
  });
  it('refuses before body reading and per-IP writes when global admission is exhausted', async () => {
    await policy('max_upload_attempts = 1');
    await admitUpload(storage.DB, 10);
    const request = uploadRequest();
    let readers = 0,
      r2 = 0;
    const original = request.body!.getReader.bind(request.body);
    request.body!.getReader = ((...args: any[]) => {
      readers++;
      return (original as any)(...args);
    }) as any;
    const target = instrumentStorage(storage, (op, _sql, phase) => {
      if (phase === 'before' && ['put', 'get', 'head'].includes(op)) r2++;
    });
    expect((await worker.fetch(request, env(target))).status).toBe(503);
    expect(readers).toBe(0);
    expect(r2).toBe(0);
    expect(await storage.DB.prepare('SELECT COUNT(*) AS n FROM rate_limits').first()).toEqual({
      n: 0,
    });
    expect((await usage()).upload_attempts).toBe(1);
  });
  it('charges invalid uploads and does not refund a lost admission acknowledgement', async () => {
    const bad = new Request('http://localhost/api/comparisons', {
      method: 'POST',
      headers: {
        Origin: origin,
        ...publicationHeaders(testPublicationCredentials()),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect((await worker.fetch(bad, env())).status).toBe(415);
    const before = await usage();
    const target = instrumentStorage(storage, (op, sql, phase) => {
      if (op === 'first' && sql.includes('upload_attempts, upload_bytes') && phase === 'after')
        throw new Error('Lost admission response');
    });
    expect((await worker.fetch(uploadRequest(), env(target))).status).toBe(503);
    expect((await usage()).upload_attempts).toBe(before.upload_attempts + 1);
    expect(await objectCount()).toBe(0);
    expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
  });
  it('reserves publication quota and the daily count once under concurrent independent writers', async () => {
    await policy('max_publications = 1');
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => save()));
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await usage()).toMatchObject({ publications: 1, publication_bytes: png.length * 2 });
    expect(await quota()).toEqual({ used_bytes: png.length * 2, comparisons: 1 });
    expect(await objectCount()).toBe(2);
    expect(
      await storage.DB.prepare('SELECT COUNT(*) AS n FROM publication_requests').first(),
    ).toEqual({ n: 1 });
  });
  it('does not recover daily publication capacity by deleting a comparison', async () => {
    await policy('max_publication_bytes = ' + png.length * 2);
    const result = (await save()) as { id: string };
    await eraseComparison(storage, (await row(result.id))!);
    await expect(save()).rejects.toThrow('Daily publication budget');
    expect(await usage()).toMatchObject({ publications: 1, publication_bytes: png.length * 2 });
    expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
    expect(await objectCount()).toBe(0);
    await expect(admitUpload(storage.DB, 1)).rejects.toMatchObject({ status: 503 });
    expect(await (await api('/api/health')).json()).toMatchObject({ uploadsEnabled: false });
  });
  it('keeps failed R2 work charged after compensation', async () => {
    const target = instrumentStorage(storage, (op, _key, phase) => {
      if (op === 'put' && phase === 'after') throw new Error('Lost put response');
    });
    await expect(save(target)).rejects.toMatchObject({ status: 503 });
    expect((await usage()).publications).toBe(1);
    expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
    expect(await objectCount()).toBe(0);
  });
  it.each(['0', '-1', 'not-a-limit', '9007199254740992'])(
    'fails closed for existing operator limits set to %s',
    async (value) => {
      const response = await worker.fetch(
        uploadRequest(),
        env(storage, { MAX_STORAGE_BYTES: value }),
      );
      expect([503, 507]).toContain(response.status);
      expect(await objectCount()).toBe(0);
      expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
    },
  );
});

describe('emergency publication stop', () => {
  it('requires operator authorization without touching D1 and exposes no public costs', async () => {
    let operations = 0;
    const target = env(
      instrumentStorage(storage, (_op, _key, phase) => {
        if (phase === 'before') operations++;
      }),
    );
    for (const path of ['/api/admin/publishing/stop', '/api/admin/costs']) {
      const response = await api(
        path,
        {
          method: path.endsWith('stop') ? 'POST' : 'GET',
          headers: { Authorization: 'Bearer wrong' },
        },
        target,
      );
      expect(response.status).toBe(403);
    }
    expect(operations).toBe(0);
    const status = await api('/api/admin/costs', {
      headers: { Authorization: 'Bearer test-operator-key' },
    });
    expect(status.status).toBe(200);
    expect(status.headers.get('cache-control')).toBe('no-store');
    expect(await status.json()).toMatchObject({
      day: utcDay(),
      quota: { comparisons: 0 },
      control: { publishing_paused: 0 },
    });
  });
  it('persists a stop immediately, never resumes through HTTP, and preserves private recovery/deletion', async () => {
    const request = uploadRequest(),
      headers = Object.fromEntries(request.headers);
    const result = (await (await worker.fetch(request, env())).json()) as { id: string };
    const stop = await api('/api/admin/publishing/stop', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-operator-key' },
    });
    expect(stop.status).toBe(200);
    expect((await readControl(storage.DB)).publishing_paused).toBe(1);
    expect(await (await api('/api/health')).json()).toMatchObject({ uploadsEnabled: false });
    expect((await worker.fetch(uploadRequest(), env())).status).toBe(503);
    expect((await api('/api/comparisons/' + result.id)).status).toBe(200);
    const original = await api('/api/comparisons/' + result.id + '/images/0');
    expect(original.status).toBe(200);
    await original.arrayBuffer();
    expect(
      (
        await api('/api/admin/publishing/resume', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-operator-key' },
        })
      ).status,
    ).toBe(404);
    await policy('max_read_requests = 0, max_upload_attempts = 0, max_image_reads = 0');
    expect((await api('/api/publications/result', { method: 'POST', headers })).status).toBe(200);
    expect((await api('/api/comparisons/' + result.id, { method: 'DELETE', headers })).status).toBe(
      204,
    );
    expect(await objectCount()).toBe(0);
  });
  it('fences an earlier admission even after the operator has resumed publishing', async () => {
    const generation = await admitUpload(storage.DB, 100);
    await stopPublishing(storage.DB);
    await policy('publishing_paused = 0, generation = generation + 1');
    await expect(save(storage, generation)).rejects.toThrow('Publishing is stopped');
    expect(await objectCount()).toBe(0);
    expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
    expect((await save()).status).toBe('active');
  });
  it('refuses stale intake after stop/resume before fingerprint lookup or pending insertion', async () => {
    const request = uploadRequest();
    const original = request.body!.getReader.bind(request.body);
    let stopped = false,
      laterQueries = 0;
    request.body!.getReader = (() => {
      const reader = original();
      return new Proxy(reader, {
        get(target, property) {
          if (property === 'read')
            return async () => {
              const chunk = await target.read();
              if (!stopped) {
                stopped = true;
                await stopPublishing(storage.DB);
                await policy('publishing_paused = 0, generation = generation + 1');
              }
              return chunk;
            };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }) as any;
    const target = instrumentStorage(storage, (op, sql, phase) => {
      if (
        phase === 'before' &&
        op === 'first' &&
        (sql.startsWith('INSERT INTO comparisons') || sql.startsWith('SELECT p.comparison_id'))
      )
        laterQueries++;
    });
    expect((await worker.fetch(request, env(target))).status).toBe(503);
    expect(stopped).toBe(true);
    expect(laterQueries).toBe(0);
    expect(await objectCount()).toBe(0);
    expect(await usage()).toMatchObject({ upload_attempts: 1, publications: 0 });
  });
  it('keeps the stop durable when its committed acknowledgement is lost', async () => {
    const target = instrumentStorage(storage, (op, sql, phase) => {
      if (
        op === 'first' &&
        sql.startsWith('UPDATE service_control SET publishing_paused = 1') &&
        phase === 'after'
      )
        throw new Error('Lost stop acknowledgement');
    });
    expect(
      (
        await api(
          '/api/admin/publishing/stop',
          { method: 'POST', headers: { Authorization: 'Bearer test-operator-key' } },
          env(target),
        )
      ).status,
    ).toBe(503);
    expect((await readControl(storage.DB)).publishing_paused).toBe(1);
    expect((await worker.fetch(uploadRequest(), env())).status).toBe(503);
    expect(
      (
        await api('/api/admin/publishing/stop', {
          method: 'POST',
          headers: { Authorization: 'Bearer test-operator-key' },
        })
      ).status,
    ).toBe(200);
    expect((await readControl(storage.DB)).publishing_paused).toBe(1);
  });
  it.each([0, 1])('never activates a writer stopped during image %s commit', async (index) => {
    let puts = 0;
    const target = instrumentStorage(storage, async (op, key, phase) => {
      if (op === 'put' && phase === 'after') {
        puts++;
        if (key.endsWith('/' + index)) await stopPublishing(storage.DB);
      }
    });
    await expect(save(target)).rejects.toMatchObject({ status: 503 });
    expect(puts).toBe(index + 1);
    expect(await objectCount()).toBe(0);
    expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
  });
  it('cannot activate a last in-flight write after a stop/resume cycle', async () => {
    const target = instrumentStorage(storage, async (op, key, phase) => {
      if (op === 'put' && key.endsWith('/1') && phase === 'after') {
        await stopPublishing(storage.DB);
        await policy('publishing_paused = 0, generation = generation + 1');
      }
    });
    await expect(save(target)).rejects.toMatchObject({ status: 503 });
    expect(await objectCount()).toBe(0);
    expect((await usage()).publications).toBe(1);
  });
  it('fails closed when control state is missing or D1 admission is unavailable', async () => {
    const result = (await save()) as { id: string };
    await storage.DB.exec('DELETE FROM service_control;');
    expect((await worker.fetch(uploadRequest(), env())).status).toBe(503);
    expect((await api('/api/comparisons/' + result.id + '/images/0')).status).toBe(503);
    await storage.DB.exec('INSERT INTO service_control (id) VALUES (1);');
    await configureTestCostControls(storage.DB);
    let puts = 0;
    const target = instrumentStorage(storage, (op, sql, phase) => {
      if (op === 'put') puts++;
      if (op === 'first' && sql.startsWith('INSERT INTO daily_usage') && phase === 'before')
        throw new Error('D1 unavailable');
    });
    expect((await worker.fetch(uploadRequest(), env(target))).status).toBe(503);
    expect(puts).toBe(0);
  });
});

describe('public reads, R2 operations and retention', () => {
  it('globally bounds public reads across concurrent callers', async () => {
    await policy('max_read_requests = 2');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => admitRead(storage.DB)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect((await usage()).read_requests).toBe(2);
  });
  it('enforces image-operation and byte reservations atomically without refunding', async () => {
    await policy('max_image_reads = 2, max_image_bytes = 100');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => admitImage(storage.DB, 50)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(await usage()).toMatchObject({ image_reads: 2, image_bytes: 100 });
  });
  it('rejects before R2 when image bytes or read admission is exhausted', async () => {
    const result = (await save()) as { id: string };
    let gets = 0;
    const target = env(
      instrumentStorage(storage, (op, _key, phase) => {
        if (op === 'get' && phase === 'before') gets++;
      }),
    );
    await policy('max_image_bytes = ' + (png.length - 1));
    expect(
      (await api('/api/comparisons/' + result.id + '/images/0', undefined, target)).status,
    ).toBe(503);
    expect(gets).toBe(0);
    await policy('max_image_bytes = 100000, max_read_requests = 0');
    expect(
      (await api('/api/comparisons/' + result.id + '/images/0', undefined, target)).status,
    ).toBe(503);
    expect(gets).toBe(0);
  });
  it('uses R2 HEAD without a body and charges only the operation for HEAD', async () => {
    const result = (await save()) as { id: string };
    let gets = 0,
      heads = 0;
    const target = env(
      instrumentStorage(storage, (op, _key, phase) => {
        if (phase === 'before') {
          if (op === 'get') gets++;
          if (op === 'head') heads++;
        }
      }),
    );
    await policy('max_image_bytes = 0');
    const response = await api(
      '/api/comparisons/' + result.id + '/images/0',
      { method: 'HEAD' },
      target,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-length')).toBe(String(png.length));
    expect(gets).toBe(0);
    expect(heads).toBe(1);
    expect(await usage()).toMatchObject({ image_reads: 1, image_bytes: 0 });
  });
  it('charges failures and full original responses before opening an R2 stream', async () => {
    const result = (await save()) as { id: string };
    const target = env(
      instrumentStorage(storage, (op, _key, phase) => {
        if (op === 'get' && phase === 'before') throw new Error('R2 down');
      }),
    );
    expect(
      (await api('/api/comparisons/' + result.id + '/images/0', undefined, target)).status,
    ).toBe(503);
    const response = await api('/api/comparisons/' + result.id + '/images/0');
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(png));
    expect(await usage()).toMatchObject({ image_reads: 2, image_bytes: png.length * 2 });
  });
  it('does not serve a larger corrupt object than the reserved manifest size', async () => {
    const result = (await save()) as { id: string };
    await storage.IMAGES.put('comparisons/' + result.id + '/0', new Uint8Array(png.length + 1));
    expect((await api('/api/comparisons/' + result.id + '/images/0')).status).toBe(503);
  });
  it('trims old aggregate counters while preserving the retention boundary', async () => {
    const now = Date.now(),
      old = utcDay(now - 36 * 86400000),
      boundary = utcDay(now - 35 * 86400000);
    await storage.DB.prepare('INSERT INTO daily_usage (day) VALUES (?), (?)')
      .bind(old, boundary)
      .run();
    await sweepComparisons(storage, now);
    expect(await usage(old)).toEqual({});
    expect(await usage(boundary)).toMatchObject({ day: boundary });
  });
  it('continues comparison removal if aggregate counter retention fails', async () => {
    const result = (await save()) as { id: string };
    await storage.DB.prepare(
      "UPDATE comparisons SET status = 'deleting', cleanup_after = 0 WHERE id = ?",
    )
      .bind(result.id)
      .run();
    const target = instrumentStorage(storage, (op, sql, phase) => {
      if (op === 'run' && sql.startsWith('DELETE FROM daily_usage') && phase === 'before')
        throw new Error('Counter retention unavailable');
    });
    await expect(sweepComparisons(target)).rejects.toThrow('failed operation');
    expect(await row(result.id)).toBeNull();
    expect(await objectCount()).toBe(0);
    expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
  });
});
