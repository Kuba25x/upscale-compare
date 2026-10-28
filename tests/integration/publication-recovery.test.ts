import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  ABANDONED_UPLOAD_GRACE_MS,
  CLEANUP_BATCH_SIZE,
  CLEANUP_LEASE_MS,
  eraseComparison,
  PENDING_LIFETIME_MS,
  saveComparison,
  sweepComparisons,
  type ComparisonRow,
  type Storage,
} from '../../worker/src/publication-store';
import { emptyImageMetadata, emptyMetadata, type PublicComparison } from '../../shared/model';
import { migrateTestDatabase } from '../fixtures/database';
import { rasterPng } from '../fixtures/png';
import { findPublication, type PublicationIntent } from '../../worker/src/publication-retry';
import { randomHex, PUBLICATION_RETRY_MS } from '../../shared/publication';

let mf: Miniflare,
  storage: Storage,
  counter = 0;
const png = rasterPng(16, 12);
const images = Array.from({ length: 4 }, () => ({ bytes: new Uint8Array(png), type: 'image/png' }));
const limits = { maxStorageBytes: 1048576, maxComparisons: 100 };
function comparison(): PublicComparison {
  return {
    id: (++counter).toString(16).padStart(16, '0'),
    createdAt: new Date().toISOString(),
    metadata: emptyMetadata(),
    config: {
      mode: 'side',
      selected: [3, 1],
      divider: 0.37,
      view: { zoom: 2, center: { x: 8, y: 6 } },
    },
    images: images.map((image, i) => ({
      label: 'Image ' + i,
      metadata: emptyImageMetadata(),
      width: 16,
      height: 12,
      size: image.bytes.length,
      type: image.type,
      name: 'screenshot-' + i + '.png',
    })),
  };
}
const digest = (data: PublicComparison) => 'private-test-digest-' + data.id;
const save = (data = comparison(), target = storage, caps = limits) =>
  saveComparison(target, data, digest(data), images, caps);
const row = (id: string) =>
  storage.DB.prepare('SELECT * FROM comparisons WHERE id = ?').bind(id).first<ComparisonRow>();
const quota = () =>
  storage.DB.prepare('SELECT used_bytes, comparisons FROM quota WHERE id = 1').first();
const objects = async () => (await storage.IMAGES.list()).objects;
const empty = async () => {
  expect(await quota()).toEqual({ used_bytes: 0, comparisons: 0 });
  expect(await objects()).toHaveLength(0);
  expect((await storage.DB.prepare('SELECT id FROM comparisons').all()).results).toHaveLength(0);
};
async function hidden(id: string) {
  for (const path of ['/api/comparisons/' + id, '/api/comparisons/' + id + '/images/0', '/s/' + id])
    expect((await mf.dispatchFetch('http://localhost' + path)).status).toBe(404);
}

type Hook = (operation: string, sql: string, phase: 'before' | 'after') => void | Promise<void>;
// Inject transport faults around REAL local D1/R2 operations; no mock SQL engine
// and no test-only route or failure switch in the production Worker.
function faulty(hook: Hook): Storage {
  const raw = new WeakMap<object, object>();
  function statement(target: object, sql: string): object {
    const wrapped = new Proxy(target, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === 'bind')
          return (...args: unknown[]) => statement(value.apply(target, args), sql);
        if (['first', 'all', 'run'].includes(String(property)))
          return async (...args: unknown[]) => {
            await hook(String(property), sql, 'before');
            const result = await value.apply(target, args);
            await hook(String(property), sql, 'after');
            return result;
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    raw.set(wrapped, target);
    return wrapped;
  }
  return {
    DB: new Proxy(storage.DB, {
      get(target, property) {
        if (property === 'prepare') return (sql: string) => statement(target.prepare(sql), sql);
        if (property === 'batch')
          return async (statements: object[]) => {
            await hook('batch', '', 'before');
            const result = await target.batch(
              statements.map((item) => raw.get(item) || item) as Parameters<typeof target.batch>[0],
            );
            await hook('batch', '', 'after');
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    IMAGES: new Proxy(storage.IMAGES, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === 'put' || property === 'delete')
          return async (...args: unknown[]) => {
            const key = String(args[0]);
            await hook(String(property), key, 'before');
            const result = await value.apply(target, args);
            await hook(String(property), key, 'after');
            return result;
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
}
const fail = () => {
  throw new Error('Injected storage transport failure');
};
async function due(data = comparison(), status: 'pending' | 'deleting' = 'deleting') {
  await save(data);
  await storage.DB.prepare('UPDATE comparisons SET status = ?, cleanup_after = 0 WHERE id = ?')
    .bind(status, data.id)
    .run();
  if (status === 'pending')
    await storage.DB.prepare('UPDATE comparisons SET created_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - PENDING_LIFETIME_MS - 1000).toISOString(), data.id)
      .run();
  return data;
}
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'worker/dist/index.js',
      compatibilityDate: '2026-07-01',
      d1Databases: ['DB', 'LEGACY'],
      r2Buckets: ['IMAGES'],
      bindings: {
        ENVIRONMENT: 'development',
        UPLOADS_ENABLED: 'false',
        ALLOWED_ORIGINS: 'http://localhost:5173',
        FRONTEND_URL: 'http://localhost:5173/',
      },
    }),
  );
  storage = {
    DB: await mf.getD1Database('DB'),
    IMAGES: await mf.getR2Bucket('IMAGES'),
  } as unknown as Storage;
  await migrateTestDatabase(storage.DB);
});
beforeEach(async () => {
  await storage.DB.exec(
    'DROP TRIGGER IF EXISTS test_insert_failure; DROP TRIGGER IF EXISTS test_quota_failure; DROP TRIGGER IF EXISTS test_delete_failure; DROP TRIGGER IF EXISTS test_request_failure; DELETE FROM comparisons; DELETE FROM publication_requests; DELETE FROM rate_limits; INSERT OR IGNORE INTO quota (id) VALUES (1); UPDATE quota SET used_bytes = 0, comparisons = 0;',
  );
  const keys = (await objects()).map((object) => object.key);
  if (keys.length) await storage.IMAGES.delete(keys);
});
describe('durable publication identity under storage failures', () => {
  const intent = (): PublicationIntent => ({
    keyHash: randomHex(32),
    digest: randomHex(32),
    requestHash: randomHex(32),
    expiresAt: Date.now() + PUBLICATION_RETRY_MS,
  });
  const saveIntent = (
    key: PublicationIntent,
    target = storage,
    data = comparison(),
    caps = limits,
  ) => saveComparison(target, data, key.digest, images, caps, key);
  it('rolls back the pending row and quota if writing the idempotency marker fails', async () => {
    await storage.DB.exec(
      "CREATE TRIGGER test_request_failure BEFORE INSERT ON publication_requests BEGIN SELECT RAISE(ABORT, 'Injected marker failure'); END;",
    );
    await expect(saveIntent(intent())).rejects.toThrow();
    await empty();
    expect(
      (await storage.DB.prepare('SELECT * FROM publication_requests').all()).results,
    ).toHaveLength(0);
  });
  it('recovers the pending result after INSERT commits with a lost acknowledgement', async () => {
    const key = intent();
    await expect(
      saveIntent(
        key,
        faulty((op, sql, phase) => {
          if (op === 'first' && sql.startsWith('INSERT INTO comparisons') && phase === 'after')
            fail();
        }),
      ),
    ).rejects.toThrow();
    expect(await findPublication(storage.DB, key)).toEqual({ status: 'pending' });
    expect(await saveIntent(key)).toEqual({ status: 'pending' });
    expect(await objects()).toHaveLength(0);
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
  });
  it('can retry the same identity if the initial INSERT never committed', async () => {
    const key = intent();
    await expect(
      saveIntent(
        key,
        faulty((op, sql, phase) => {
          if (op === 'first' && sql.startsWith('INSERT INTO comparisons') && phase === 'before')
            fail();
        }),
      ),
    ).rejects.toThrow();
    expect(await findPublication(storage.DB, key)).toBeNull();
    expect((await saveIntent(key)).status).toBe('active');
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
  });
  it('recovers an activation that committed before its acknowledgement was lost', async () => {
    const key = intent(),
      data = comparison();
    await expect(
      saveIntent(
        key,
        faulty((op, sql, phase) => {
          if (op === 'first' && sql.includes("SET status = 'active'") && phase === 'after') fail();
        }),
        data,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(await findPublication(storage.DB, key)).toEqual({ status: 'active', id: data.id });
    expect(await saveIntent(key)).toEqual({ status: 'active', id: data.id });
    expect(await objects()).toHaveLength(4);
  });
  it('allows only one writer and reservation for concurrent retries across callers', async () => {
    const key = intent();
    let puts = 0;
    const target = faulty((op, _sql, phase) => {
      if (op === 'put' && phase === 'before') puts++;
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => saveIntent(key, target)));
    expect(results.filter((result) => result.status === 'active').length).toBeGreaterThanOrEqual(1);
    expect(puts).toBe(4);
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    expect(
      (await storage.DB.prepare('SELECT * FROM publication_requests').all()).results,
    ).toHaveLength(1);
  });
  it('recovers an existing result even when no capacity remains', async () => {
    const key = intent(),
      first = await saveIntent(key);
    expect(
      await storage.DB.prepare(
        'SELECT publication_key, request_hash, retry_until FROM comparisons WHERE id = ?',
      )
        .bind((first as { id: string }).id)
        .first(),
    ).toEqual({ publication_key: null, request_hash: null, retry_until: 0 });
    expect(
      await saveIntent(key, storage, comparison(), { maxStorageBytes: 1, maxComparisons: 1 }),
    ).toEqual(first);
  });
  it('never writes images while a prior writer still owns a pending publication', async () => {
    const key = intent();
    const writer = saveIntent(
      key,
      faulty(async (op, sql, phase) => {
        if (op === 'put' && sql.endsWith('/0') && phase === 'before') {
          const retry = await saveIntent(
            key,
            faulty((operation) => {
              if (operation === 'put') fail();
            }),
          );
          expect(retry).toEqual({ status: 'pending' });
        }
      }),
    );
    expect((await writer).status).toBe('active');
    expect(await objects()).toHaveLength(4);
  });
  it('keeps failed-attempt tombstones after compensation and refuses resurrection', async () => {
    const key = intent();
    await expect(
      saveIntent(
        key,
        faulty((op, _sql, phase) => {
          if (op === 'put' && phase === 'before') fail();
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
    await empty();
    await expect(findPublication(storage.DB, key)).rejects.toMatchObject({ status: 410 });
    await expect(saveIntent(key)).rejects.toMatchObject({ status: 410 });
    await empty();
  });
  it('rejects conflicting content or private capability without touching the first publication', async () => {
    const key = intent(),
      first = await saveIntent(key);
    await expect(saveIntent({ ...key, requestHash: randomHex(32) })).rejects.toMatchObject({
      status: 409,
    });
    await expect(saveIntent({ ...key, digest: randomHex(32) })).rejects.toMatchObject({
      status: 404,
    });
    expect(await findPublication(storage.DB, key)).toEqual(first);
    expect(await objects()).toHaveLength(4);
  });
  it('expires bounded tombstone batches without removing active comparisons', async () => {
    const key = intent(),
      result = await saveIntent(key);
    await storage.DB.prepare('UPDATE publication_requests SET expires_at = 1').run();
    for (let i = 0; i < 104; i++)
      await storage.DB.prepare('INSERT INTO publication_requests VALUES (?, ?, ?, ?, 1)')
        .bind(randomHex(32), randomHex(8), randomHex(32), randomHex(32))
        .run();
    await sweepComparisons(storage);
    expect(
      (await storage.DB.prepare('SELECT * FROM publication_requests').all()).results,
    ).toHaveLength(5);
    await sweepComparisons(storage);
    expect(
      (await storage.DB.prepare('SELECT * FROM publication_requests').all()).results,
    ).toHaveLength(0);
    expect((await row((result as { id: string }).id))!.status).toBe('active');
    await expect(saveIntent({ ...key, expiresAt: Date.now() - 1 })).rejects.toMatchObject({
      status: 410,
    });
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
  });
  it('continues object cleanup if tombstone expiry maintenance fails', async () => {
    const data = await due();
    await expect(
      sweepComparisons(
        faulty((op, sql, phase) => {
          if (
            op === 'run' &&
            sql.startsWith('DELETE FROM publication_requests') &&
            phase === 'before'
          )
            fail();
        }),
      ),
    ).rejects.toThrow('failed operation');
    expect(await row(data.id)).toBeNull();
    await empty();
  });
});
afterAll(async () => {
  await mf?.dispose();
});

describe('atomic publication reservation', () => {
  it('upgrades legacy rows without recharging them and tolerates the old reservation SQL', async () => {
    const legacy = await mf.getD1Database('LEGACY');
    await legacy.exec(
      (await readFile('worker/migrations/0001_initial.sql', 'utf8')).replace(/\n/g, ' '),
    );
    for (const [id, status] of [
      ['a', 'active'],
      ['b', 'pending'],
      ['c', 'deleting'],
    ]) {
      await legacy
        .prepare(
          'INSERT INTO comparisons (id, payload, delete_hash, bytes, created_at, status) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(id.repeat(16), '{}', 'legacy-digest', 200, '2026-01-01T00:00:00.000Z', status)
        .run();
    }
    await legacy.prepare('UPDATE quota SET used_bytes = 600, comparisons = 3').run();
    await migrateTestDatabase(legacy);
    expect(await legacy.prepare('SELECT used_bytes, comparisons FROM quota').first()).toEqual({
      used_bytes: 600,
      comparisons: 3,
    });
    expect(
      (await legacy.prepare('SELECT status FROM comparisons ORDER BY id').all()).results.map(
        (item) => item.status,
      ),
    ).toEqual(['active', 'pending', 'deleting']);
    const pending = await legacy
      .prepare('SELECT cleanup_after FROM comparisons WHERE id = ?')
      .bind('b'.repeat(16))
      .first();
    expect(pending!.cleanup_after).toBe(Date.parse('2026-01-01T01:00:00.000Z'));
    // Old Worker code omits cleanup_after and already performs this reservation.
    await legacy
      .prepare('UPDATE quota SET used_bytes = used_bytes + 7, comparisons = comparisons + 1')
      .run();
    await legacy
      .prepare(
        'INSERT INTO comparisons (id, payload, delete_hash, bytes, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind('d'.repeat(16), '{}', 'legacy-digest', 7, new Date().toISOString())
      .run();
    expect(await legacy.prepare('SELECT used_bytes, comparisons FROM quota').first()).toEqual({
      used_bytes: 607,
      comparisons: 4,
    });
    await sweepComparisons({ DB: legacy as unknown as Storage['DB'], IMAGES: storage.IMAGES });
    expect(
      (await legacy
        .prepare('SELECT status FROM comparisons WHERE id = ?')
        .bind('d'.repeat(16))
        .first())!.status,
    ).toBe('pending');
  });
  it('rolls back quota when inserting the pending row fails', async () => {
    await storage.DB.exec(
      "CREATE TRIGGER test_insert_failure BEFORE INSERT ON comparisons BEGIN SELECT RAISE(ABORT, 'Injected insert failure'); END;",
    );
    await expect(save()).rejects.toThrow();
    await empty();
  });
  it('rolls back the pending row when its quota trigger fails', async () => {
    await storage.DB.exec(
      "CREATE TRIGGER test_quota_failure BEFORE UPDATE ON quota BEGIN SELECT RAISE(ABORT, 'Injected quota failure'); END;",
    );
    await expect(save()).rejects.toThrow();
    await empty();
  });
  it('refuses full byte/count capacity without creating a pending row', async () => {
    for (const caps of [
      { ...limits, maxStorageBytes: 1 },
      { ...limits, maxComparisons: 0 },
    ]) {
      await expect(save(comparison(), storage, caps)).rejects.toMatchObject({ status: 507 });
      await empty();
    }
  });
  it('reserves at most one slot across concurrent storage callers', async () => {
    const results = await Promise.allSettled(
      [0, 1, 2].map(() => save(comparison(), storage, { ...limits, maxComparisons: 1 })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    expect(await objects()).toHaveLength(4);
  });
  it('never compensates another publication after an ID collision', async () => {
    const data = comparison();
    await save(data);
    const original = await row(data.id);
    await expect(saveComparison(storage, data, 'another-digest', images, limits)).rejects.toThrow();
    expect(await row(data.id)).toEqual(original);
    expect(await objects()).toHaveLength(4);
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
  });
  it('retains a recoverable pending row after losing the INSERT response', async () => {
    const data = comparison();
    await expect(
      save(
        data,
        faulty((op, sql, phase) => {
          if (op === 'first' && sql.startsWith('INSERT INTO comparisons') && phase === 'after')
            fail();
        }),
      ),
    ).rejects.toThrow();
    const pending = (await row(data.id))!;
    expect(pending.status).toBe('pending');
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    await hidden(data.id);
    await sweepComparisons(storage, pending.cleanup_after + 1);
    expect((await row(data.id))!.status).toBe('deleting');
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    await sweepComparisons(storage, pending.cleanup_after + ABANDONED_UPLOAD_GRACE_MS + 2);
    await empty();
  });
});

describe('publication compensation and ambiguous responses', () => {
  it.each([0, 1, 2, 3].flatMap((index) => ['before', 'after'].map((phase) => ({ index, phase }))))(
    'cleans all keys after R2 put $index fails $phase commit',
    async ({ index, phase }) => {
      await expect(
        save(
          comparison(),
          faulty((op, key, when) => {
            if (op === 'put' && key.endsWith('/' + index) && when === phase) fail();
          }),
        ),
      ).rejects.toMatchObject({ status: 503 });
      await empty();
    },
  );
  it('compensates an activation failure before commit', async () => {
    await expect(
      save(
        comparison(),
        faulty((op, sql, phase) => {
          if (op === 'first' && sql.includes("SET status = 'active'") && phase === 'before') fail();
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
    await empty();
  });
  it('preserves an active publication when activation committed but its response was lost', async () => {
    const data = comparison();
    await expect(
      save(
        data,
        faulty((op, sql, phase) => {
          if (op === 'first' && sql.includes("SET status = 'active'") && phase === 'after') fail();
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect((await row(data.id))!.status).toBe('active');
    expect(await objects()).toHaveLength(4);
    expect((await mf.dispatchFetch('http://localhost/api/comparisons/' + data.id)).status).toBe(
      200,
    );
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
  });
  it.each(['before', 'after'])(
    'retries R2 rollback deletion after failure %s commit',
    async (phase) => {
      const data = comparison();
      await expect(
        save(
          data,
          faulty((op, key, when) => {
            if (
              (op === 'put' && key.endsWith('/1') && when === 'before') ||
              (op === 'delete' && when === phase)
            )
              fail();
          }),
        ),
      ).rejects.toMatchObject({ status: 503 });
      const retained = (await row(data.id))!;
      expect(retained.status).toBe('deleting');
      expect(retained.cleanup_attempts).toBe(1);
      await hidden(data.id);
      expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
      await sweepComparisons(storage, retained.cleanup_after + 1);
      await sweepComparisons(storage, retained.cleanup_after + 2);
      await empty();
    },
  );
  it.each(['before', 'after'])(
    'recovers after cleanup transaction response fails %s commit',
    async (phase) => {
      const data = comparison();
      await expect(
        save(
          data,
          faulty((op, key, when) => {
            if (
              (op === 'put' && key.endsWith('/1') && when === 'before') ||
              (op === 'batch' && when === phase)
            )
              fail();
          }),
        ),
      ).rejects.toMatchObject({ status: 503 });
      if (phase === 'before') {
        const retained = (await row(data.id))!;
        expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
        await sweepComparisons(storage, retained.cleanup_after + 1);
      }
      await empty();
    },
  );
  it.each(['before', 'after'])(
    'keeps a durable retry marker if compensation cannot claim the row %s commit',
    async (phase) => {
      const data = comparison();
      await expect(
        save(
          data,
          faulty((op, sql, when) => {
            if (
              (op === 'put' && sql.endsWith('/1') && when === 'before') ||
              (op === 'first' &&
                sql.startsWith("UPDATE comparisons SET status = 'deleting'") &&
                when === phase)
            )
              fail();
          }),
        ),
      ).rejects.toMatchObject({ status: 503 });
      const retained = (await row(data.id))!;
      expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
      await sweepComparisons(storage, retained.cleanup_after + 1);
      const retry = await row(data.id);
      if (retry) await sweepComparisons(storage, retry.cleanup_after + 1);
      await empty();
    },
  );
});

describe('deletion and scheduled recovery', () => {
  it('defers retry after a lost claim response instead of losing the deletion marker', async () => {
    const data = await due();
    const now = Date.now();
    await expect(
      sweepComparisons(
        faulty((op, sql, phase) => {
          if (op === 'first' && sql.includes("status != 'active'") && phase === 'after') fail();
        }),
        now,
      ),
    ).rejects.toThrow();
    expect((await row(data.id))!.cleanup_after).toBe(now + CLEANUP_LEASE_MS);
    expect(await objects()).toHaveLength(4);
    await sweepComparisons(storage, now + CLEANUP_LEASE_MS + 1);
    await empty();
  });
  it('does not let one failed D1 claim stop the next comparison', async () => {
    const first = await due(),
      second = await due();
    let failed = false;
    await expect(
      sweepComparisons(
        faulty((op, sql, phase) => {
          if (
            !failed &&
            op === 'first' &&
            sql.includes("status != 'active'") &&
            phase === 'before'
          ) {
            failed = true;
            fail();
          }
        }),
      ),
    ).rejects.toThrow();
    expect(await row(first.id)).not.toBeNull();
    expect(await row(second.id)).toBeNull();
    await sweepComparisons(storage);
    await empty();
  });
  it('holds quota when an operator deletes an upload before it has activated', async () => {
    const data = comparison();
    await expect(
      save(
        data,
        faulty(async (op, key, phase) => {
          if (op === 'put' && key.endsWith('/0') && phase === 'after')
            await eraseComparison(storage, (await row(data.id))!);
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
    const retained = (await row(data.id))!;
    expect(retained.status).toBe('deleting');
    expect(retained.delete_not_before).toBeGreaterThan(Date.now());
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    await hidden(data.id);
    await sweepComparisons(storage, retained.cleanup_after + 1);
    await empty();
  });
  it('hides a failed deletion immediately and retries it without leaking quota', async () => {
    const data = comparison();
    await save(data);
    await expect(
      eraseComparison(
        faulty((op, _key, phase) => {
          if (op === 'delete' && phase === 'before') fail();
        }),
        (await row(data.id))!,
      ),
    ).rejects.toThrow();
    await hidden(data.id);
    const retained = (await row(data.id))!;
    await sweepComparisons(storage, retained.cleanup_after + 1);
    await empty();
  });
  it('rolls back quota release when deleting the D1 marker fails', async () => {
    const data = comparison();
    await save(data);
    await storage.DB.exec(
      "CREATE TRIGGER test_delete_failure BEFORE DELETE ON comparisons BEGIN SELECT RAISE(ABORT, 'Injected delete failure'); END;",
    );
    await expect(eraseComparison(storage, (await row(data.id))!)).rejects.toThrow();
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    const retained = (await row(data.id))!;
    await storage.DB.exec('DROP TRIGGER test_delete_failure;');
    await sweepComparisons(storage, retained.cleanup_after + 1);
    await empty();
  });
  it('retains the marker if the quota ledger is missing', async () => {
    const data = comparison();
    await save(data);
    await storage.DB.exec('DELETE FROM quota;');
    await expect(eraseComparison(storage, (await row(data.id))!)).rejects.toThrow();
    expect((await row(data.id))!.status).toBe('deleting');
  });
  it('does not delete a pending candidate which activates after the scheduled SELECT', async () => {
    const data = await due(comparison(), 'pending');
    await sweepComparisons(
      faulty(async (op, sql, phase) => {
        if (op === 'all' && sql.includes('ORDER BY cleanup_attempts') && phase === 'after')
          await storage.DB.prepare("UPDATE comparisons SET status = 'active' WHERE id = ?")
            .bind(data.id)
            .run();
      }),
    );
    expect((await row(data.id))!.status).toBe('active');
    expect(await objects()).toHaveLength(4);
  });
  it('continues after one R2 failure and retries the failed record later', async () => {
    const bad = await due(),
      good = await due();
    const now = Date.now();
    await expect(
      sweepComparisons(
        faulty((op, key, phase) => {
          if (op === 'delete' && key.includes(bad.id) && phase === 'before') fail();
        }),
        now,
      ),
    ).rejects.toThrow('failed operation');
    expect(await row(good.id)).toBeNull();
    expect((await row(bad.id))!.cleanup_after).toBeGreaterThan(now);
    await sweepComparisons(storage, (await row(bad.id))!.cleanup_after + 1);
    await empty();
  });
  it('does not let a full failed batch starve the next due records', async () => {
    const failed: string[] = [];
    for (let i = 0; i < CLEANUP_BATCH_SIZE; i++) failed.push((await due()).id);
    const next = await due();
    const now = Date.now();
    await storage.DB.prepare('UPDATE comparisons SET cleanup_after = ? WHERE id = ?')
      .bind(now + 600000, next.id)
      .run();
    const broken = faulty((op, key, phase) => {
      if (op === 'delete' && failed.some((id) => key.includes(id)) && phase === 'before') fail();
    });
    await expect(sweepComparisons(broken, now)).rejects.toThrow();
    await expect(sweepComparisons(broken, now + PENDING_LIFETIME_MS + 1)).rejects.toThrow();
    expect(await row(next.id)).toBeNull();
    expect(
      (await storage.DB.prepare("SELECT id FROM comparisons WHERE status = 'deleting'").all())
        .results,
    ).toHaveLength(CLEANUP_BATCH_SIZE);
  });
  it('continues comparison cleanup when expired rate-counter cleanup fails', async () => {
    const data = await due();
    await expect(
      sweepComparisons(
        faulty((op, sql, phase) => {
          if (op === 'run' && sql.startsWith('DELETE FROM rate_limits') && phase === 'before')
            fail();
        }),
      ),
    ).rejects.toThrow('failed operation');
    expect(await row(data.id)).toBeNull();
    await empty();
  });
  it('retains quota through abandoned-upload grace and removes late objects on the final pass', async () => {
    const data = await due(comparison(), 'pending');
    const now = Date.now();
    await sweepComparisons(storage, now);
    const retained = (await row(data.id))!;
    expect(retained.status).toBe('deleting');
    expect(retained.delete_not_before).toBe(now + ABANDONED_UPLOAD_GRACE_MS);
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    await storage.IMAGES.put('comparisons/' + data.id + '/3', png);
    await sweepComparisons(storage, retained.cleanup_after + 1);
    await empty();
  });
  it('never reactivates an upload reclaimed while its R2 put was in progress', async () => {
    const data = comparison();
    await expect(
      save(
        data,
        faulty(async (op, key, phase) => {
          if (op === 'put' && key.endsWith('/0') && phase === 'after') {
            await storage.DB.prepare('UPDATE comparisons SET cleanup_after = 1 WHERE id = ?')
              .bind(data.id)
              .run();
            await sweepComparisons(storage);
          }
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
    const retained = (await row(data.id))!;
    expect(retained.status).toBe('deleting');
    await hidden(data.id);
    await sweepComparisons(storage, retained.cleanup_after + 1);
    await empty();
  });
  it('releases quota once under concurrent deletion and maintenance while preserving another comparison', async () => {
    const data = await due(),
      keep = comparison();
    await save(keep);
    const snapshot = (await row(data.id))!;
    await Promise.all([
      eraseComparison(storage, snapshot),
      eraseComparison(storage, snapshot),
      sweepComparisons(storage),
    ]);
    expect(await row(data.id)).toBeNull();
    expect((await row(keep.id))!.status).toBe('active');
    expect(await quota()).toEqual({ used_bytes: png.length * 4, comparisons: 1 });
    expect(await objects()).toHaveLength(4);
  });
  it('uses generated keys even if the stored manifest JSON is corrupt', async () => {
    const data = await due();
    await storage.DB.prepare('UPDATE comparisons SET payload = ? WHERE id = ?')
      .bind('{', data.id)
      .run();
    await sweepComparisons(storage);
    await empty();
  });
});
