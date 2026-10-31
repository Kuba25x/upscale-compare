import { describe, it, expect, afterEach } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localRuntime, scratch } from '../harness.mjs';
import { rasterPng, pngChunk } from '../../../tests/fixtures/png';
import { emptyMetadata, emptyImageMetadata } from '../../../shared/model';
import { fixture } from '../corpus.mjs';

const MiB = 1024 * 1024,
  token = 'local-only-owner-capability-123456';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const tiny = rasterPng(32, 24);
const padded = (w, h) => {
  const base = rasterPng(w, h),
    padding = Buffer.alloc(20 * MiB - base.length - 12, 120);
  padding.write('Padding\0');
  return Buffer.concat([base.subarray(0, 33), pngChunk('tEXt', padding), base.subarray(33)]);
};
const manifest = (n = 2) => ({
  metadata: emptyMetadata(),
  config: {
    mode: 'side',
    selected: [n - 1, 0],
    divider: 0.37000000000000005,
    view: { zoom: 2, center: { x: 12.125, y: 8.375 } },
  },
  images: Array.from({ length: n }, (_, i) => ({
    label: `Original ${i}`,
    metadata: emptyImageMetadata(),
  })),
});
const body = (images, overrides = {}) => ({
  manifest: manifest(images.length),
  files: images.map((bytes) => ({ size: bytes.length, sha256: hash(bytes), type: 'image/png' })),
  ...overrides,
});
let runtimes = [];
afterEach(async () => {
  for (const mf of runtimes) await mf.dispose();
  runtimes = [];
});
async function setup(options) {
  const mf = await localRuntime(options);
  runtimes.push(mf);
  return mf;
}
function client(mf, id = 'case-' + randomUUID()) {
  const call = (path, method = 'GET', data, headers = {}, auth = true) =>
    mf.dispatchFetch(`http://local-research.invalid/objects/${id}${path}`, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        ...(data && !Buffer.isBuffer(data) ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : Buffer.isBuffer(data) ? data : JSON.stringify(data),
    });
  return {
    id,
    call,
    begin: (backend, images, extra = {}) =>
      call('/begin?backend=' + backend, 'POST', body(images, extra)),
    part: (image, part, bytes, headers = {}) =>
      call(`/images/${image}/parts/${part}`, 'PUT', bytes, headers),
    finalize: (headers = {}) => call('/finalize', 'POST', undefined, headers),
    status: async () => {
      const r = await call('/status');
      expect(r.status).toBe(200);
      return r.json();
    },
    erase: () => call('/delete', 'POST'),
  };
}
async function putAll(c, images) {
  for (let i = 0; i < images.length; i++)
    for (let p = 0; p < Math.ceil(images[i].length / MiB); p++)
      expect((await c.part(i, p, images[i].subarray(p * MiB, (p + 1) * MiB))).status).toBe(201);
}
async function eraseAll(c) {
  let result;
  do {
    const r = await c.erase();
    expect(r.status).toBe(200);
    result = await r.json();
  } while (result.state === 'deleting');
  return result;
}

describe.each(['sqlite', 'kv'])('%s original-image prototype', (backend) => {
  it('preserves 4K/8K originals at the exact 20 MiB/file and 40 MiB aggregate ceiling, hashes, settings and deletion', async () => {
    const mf = await setup(),
      c = client(mf),
      images = [padded(3840, 2160), padded(7680, 4320)];
    expect((await c.begin(backend, images)).status).toBe(201);
    expect((await c.call('/manifest')).status).toBe(404);
    await putAll(c, images);
    const finalized = await c.finalize();
    expect(finalized.status).toBe(200);
    const result = await finalized.json();
    expect(result.proofs.map((x) => x.sha256)).toEqual(images.map(hash));
    expect(result.proofs.map((x) => [x.width, x.height])).toEqual([
      [3840, 2160],
      [7680, 4320],
    ]);
    expect(await (await c.call('/manifest')).json()).toEqual(manifest());
    for (let i = 0; i < images.length; i++) {
      const r = await c.call('/images/' + i, 'GET', undefined, {}, false);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      const actual = Buffer.from(await r.arrayBuffer());
      expect(hash(actual)).toBe(hash(images[i]));
      expect(actual.equals(images[i])).toBe(true);
    }
    const before = await c.status();
    const first = await c.erase(),
      partial = await first.json();
    expect(partial.state).toBe('deleting');
    expect(partial.remaining).toBe(32);
    expect((await c.call('/images/0')).status).toBe(404);
    await eraseAll(c);
    expect((await c.status()).reserved).toBe(0);
    const after = await c.status();
    await writeFile(
      resolve(scratch, `${backend}-large-result.json`),
      JSON.stringify(
        {
          backend,
          scope:
            'Local workerd storage and current structural/content checks, not complete JPEG/WebP validation or edge certification.',
          imageBytes: images.map((x) => x.length),
          hashes: images.map(hash),
          stateBeforeDelete: before.state,
          usageBeforeDelete: before.usage,
          usageAfterDelete: after.usage,
          manifestRestored: true,
          originalBytesEqual: true,
        },
        null,
        2,
      ) + '\n',
    );
  });
  it.each([2, 3, 4])('round trips %i ordered originals and immutable manifest', async (n) => {
    const mf = await setup(),
      c = client(mf),
      images = Array(n).fill(tiny);
    expect((await c.begin(backend, images)).status).toBe(201);
    await putAll(c, images);
    expect((await c.finalize()).status).toBe(200);
    expect(await (await c.call('/manifest')).json()).toEqual(manifest(n));
  });
  it('preserves baseline/progressive JPEG and lossy/lossless WebP bytes in one ordered publication', async () => {
    const mf = await setup(),
      c = client(mf),
      names = ['baseline.jpg', 'progressive.jpg', 'lossy.webp', 'lossless-alpha.webp'];
    const images = await Promise.all(names.map((name) => fixture('fidelity/' + name))),
      payload = body(images);
    payload.files.forEach((s, i) => (s.type = i < 2 ? 'image/jpeg' : 'image/webp'));
    expect((await c.begin(backend, images, payload)).status).toBe(201);
    await putAll(c, images);
    expect((await c.finalize()).status).toBe(200);
    for (let i = 0; i < images.length; i++)
      expect(
        Buffer.from(await (await c.call('/images/' + i)).arrayBuffer()).equals(images[i]),
      ).toBe(true);
  });
  it('enforces byte/part/aggregate and file-count bounds before storage', async () => {
    const mf = await setup(),
      c = client(mf),
      spec = body([tiny, tiny]);
    spec.files[0].size = 20 * MiB + 1;
    expect((await c.begin(backend, [tiny, tiny], spec)).status).toBe(400);
    const aggregate = body([tiny, tiny, tiny]);
    aggregate.files.forEach((s) => (s.size = 20 * MiB));
    expect((await c.begin(backend, [tiny, tiny, tiny], aggregate)).status).toBe(413);
    expect((await c.begin(backend, [tiny])).status).toBe(400);
    expect((await c.begin(backend, [tiny, tiny])).status).toBe(201);
    expect((await c.part(0, 0, Buffer.alloc(MiB + 1))).status).toBe(413);
    expect((await c.part(0, 1, tiny)).status).toBe(409);
    expect((await c.part(0, 0, tiny.subarray(1))).status).toBe(400);
  });
  it('refuses private operations without the capability and never exposes quarantine', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    await c.part(0, 0, tiny);
    for (const path of ['/status', '/images/0', '/manifest', '/quarantine', '/arbitrary-key'])
      expect((await c.call(path, 'GET', undefined, {}, false)).status).toBe(
        path === '/status' ? 403 : 404,
      );
    expect((await c.call('/delete', 'POST', undefined, {}, false)).status).toBe(403);
    expect(
      (
        await c.call('/finalize', 'POST', undefined, {
          Authorization: 'Bearer definitely-wrong-capability',
        })
      ).status,
    ).toBe(403);
  });
  it('recovers an ambiguous committed part without changing bytes or double-writing ready data', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    expect((await c.part(0, 0, tiny, { 'X-Research-Fault': 'after-write' })).status).toBe(503);
    const before = await c.status();
    expect((await c.part(0, 0, tiny)).status).toBe(200);
    expect((await c.status()).usage.kvWrite).toBe(before.usage.kvWrite);
    const changed = Buffer.from(tiny);
    changed[changed.length - 1] ^= 1;
    expect((await c.part(0, 0, changed)).status).toBe(409);
    await c.part(1, 0, tiny);
    expect((await c.finalize()).status).toBe(200);
  });
  it('serializes simultaneous identical parts and rejects a concurrent conflicting part', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    const pair = await Promise.all([c.part(0, 0, tiny), c.part(0, 0, tiny)]);
    expect(pair.map((r) => r.status).sort()).toEqual([200, 201]);
    const altered = Buffer.from(tiny);
    altered[29] ^= 1;
    const conflict = await Promise.all([c.part(1, 0, tiny), c.part(1, 0, altered)]);
    expect(conflict.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await c.finalize()).status).toBe(200);
    expect((await c.status()).usage.kvWrite).toBe(backend === 'kv' ? 2 : 0);
  });
  it('refuses activation after a concurrent emergency stop during part intake', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    const [part, stop] = await Promise.all([c.part(0, 0, tiny), c.call('/stop', 'POST')]);
    expect([201, 503]).toContain(part.status);
    expect(stop.status).toBe(200);
    expect((await c.finalize()).status).toBe(503);
    expect((await c.call('/manifest')).status).toBe(404);
    await eraseAll(c);
  });
  it('recovers a failure before durable image write', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    expect((await c.part(0, 0, tiny, { 'X-Research-Fault': 'before-write' })).status).toBe(503);
    if (backend === 'kv') await new Promise((r) => setTimeout(r, 1150));
    expect((await c.part(0, 0, tiny)).status).toBe(201);
    await c.part(1, 0, tiny);
    expect((await c.finalize()).status).toBe(200);
  });
  it('recovers a lost activation acknowledgment using persisted identity and rejects conflicting retries', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    await putAll(c, [tiny, tiny]);
    expect((await c.finalize({ 'X-Research-Fault': 'after-activate' })).status).toBe(503);
    expect((await c.status()).state).toBe('active');
    expect((await c.finalize()).status).toBe(200);
    const changed = body([tiny, tiny]);
    changed.manifest.config.divider = 0.2;
    expect((await c.begin(backend, [tiny, tiny], changed)).status).toBe(409);
  });
  it('keeps incomplete/corrupt/mismatched content private', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    expect((await c.finalize()).status).toBe(409);
    const altered = Buffer.from(tiny);
    altered[29] ^= 1;
    await c.part(0, 0, altered);
    await c.part(1, 0, tiny);
    expect((await c.finalize()).status).toBe(415);
    expect((await c.call('/images/0')).status).toBe(404);
    const bad = client(mf),
      badBody = body([altered, tiny]);
    await bad.begin(backend, [altered, tiny], badBody);
    await putAll(bad, [altered, tiny]);
    expect((await bad.finalize()).status).toBe(415);
  });
  it('fences a stop before activation and still permits owner cleanup', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    await putAll(c, [tiny, tiny]);
    expect((await c.finalize({ 'X-Research-Fault': 'stop-before-activate' })).status).toBe(503);
    expect((await c.call('/manifest')).status).toBe(404);
    expect((await c.part(0, 0, tiny)).status).toBe(503);
    await eraseAll(c);
    expect((await c.status()).state).toBe('deleted');
  });
  it('logically hides first and retries bounded physical cleanup after failures', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin(backend, [tiny, tiny]);
    await putAll(c, [tiny, tiny]);
    await c.finalize();
    expect(
      (await c.call('/delete', 'POST', undefined, { 'X-Research-Fault': 'after-delete' })).status,
    ).toBe(503);
    expect((await c.call('/manifest')).status).toBe(404);
    expect((await c.status()).reserved).toBe(tiny.length * 2);
    await eraseAll(c);
    expect((await c.status()).reserved).toBe(0);
    expect((await c.begin(backend, [tiny, tiny])).status).toBe(410);
  });
  it('models exhausted storage as refusal without creating a pending identity', async () => {
    const mf = await setup({ caps: { storageBytes: tiny.length } }),
      c = client(mf);
    expect((await c.begin(backend, [tiny, tiny])).status).toBe(413);
    expect((await c.call('/status')).status).toBe(403);
  });
  it('preserves pending parts, ownership and deletion across an actual emulator restart', async () => {
    const base = await mkdtemp(resolve(scratch, 'persist-'));
    let mf = await setup({ persistence: base }),
      c = client(mf, 'restart-' + backend);
    try {
      await c.begin(backend, [tiny, tiny]);
      await c.part(0, 0, tiny);
      await mf.dispose();
      runtimes = runtimes.filter((x) => x !== mf);
      mf = await setup({ persistence: base });
      c = client(mf, 'restart-' + backend);
      expect((await c.status()).state).toBe('pending');
      expect((await c.part(0, 0, tiny)).status).toBe(200);
      await c.part(1, 0, tiny);
      expect((await c.finalize()).status).toBe(200);
      await mf.dispose();
      runtimes = runtimes.filter((x) => x !== mf);
      mf = await setup({ persistence: base });
      c = client(mf, 'restart-' + backend);
      expect((await c.status()).state).toBe('active');
      expect(hash(Buffer.from(await (await c.call('/images/0')).arrayBuffer()))).toBe(hash(tiny));
      expect(
        (await c.call('/delete', 'POST', undefined, { 'X-Research-Fault': 'after-delete' })).status,
      ).toBe(503);
      await mf.dispose();
      runtimes = runtimes.filter((x) => x !== mf);
      mf = await setup({ persistence: base });
      c = client(mf, 'restart-' + backend);
      expect((await c.status()).state).toBe('deleting');
      expect((await c.call('/manifest')).status).toBe(404);
      await eraseAll(c);
      await mf.dispose();
      runtimes = runtimes.filter((x) => x !== mf);
      mf = await setup({ persistence: base });
      c = client(mf, 'restart-' + backend);
      expect((await c.status()).state).toBe('deleted');
      expect((await c.status()).reserved).toBe(0);
    } finally {
      for (const active of runtimes) await active.dispose();
      runtimes = [];
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe('KV-specific consistency/quota models and actual emulator limits', () => {
  it('refuses activation on injected negative visibility then recovers when data becomes visible', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin('kv', [tiny, tiny]);
    await putAll(c, [tiny, tiny]);
    expect((await c.finalize({ 'X-Research-KV-Visibility': 'missing' })).status).toBe(503);
    expect((await c.call('/manifest')).status).toBe(404);
    expect((await c.finalize()).status).toBe(200);
  });
  it.each(['kvWrite', 'kvRead', 'kvDelete'])(
    'fails closed for injected %s exhaustion with no storage fallback',
    async (kind) => {
      const mf = await setup({ caps: { [kind]: kind === 'kvRead' ? 3 : 1 } }),
        c = client(mf);
      await c.begin('kv', [tiny, tiny]);
      await c.part(0, 0, tiny);
      const second = await c.part(1, 0, tiny);
      if (kind === 'kvWrite') {
        expect(second.status).toBe(503);
        expect((await c.call('/manifest')).status).toBe(404);
        return;
      }
      expect(second.status).toBe(201);
      if (kind === 'kvRead') {
        expect((await c.finalize()).status).toBe(200);
        const r = await c.call('/images/0');
        await r.arrayBuffer();
        await expect(
          (async () => {
            const r2 = await c.call('/images/1');
            await r2.arrayBuffer();
          })(),
        ).rejects.toThrow();
        return;
      }
      await c.finalize();
      expect((await c.erase()).status).toBe(503);
      expect((await c.call('/manifest')).status).toBe(404);
      expect((await c.status()).reserved).toBeGreaterThan(0);
    },
  );
  it('a stale physical value after deletion cannot bypass the fresh visibility gate', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin('kv', [tiny, tiny]);
    await putAll(c, [tiny, tiny]);
    await c.finalize();
    const kv = await mf.getKVNamespace('ORIGINALS'),
      keys = (await kv.list()).keys;
    await eraseAll(c);
    await kv.put(keys[0].name, tiny); // deterministic model of a stale regional cache
    expect((await c.call('/images/0')).status).toBe(404);
    expect((await c.call('/manifest')).status).toBe(404);
  });
  it('detects KV bytes changed outside the journal before activation', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin('kv', [tiny, tiny]);
    await putAll(c, [tiny, tiny]);
    const kv = await mf.getKVNamespace('ORIGINALS'),
      key = (await kv.list()).keys[0].name,
      changed = Buffer.from(tiny);
    changed[29] ^= 1;
    await kv.put(key, changed);
    expect((await c.finalize()).status).toBe(415);
    expect((await c.call('/manifest')).status).toBe(404);
  });
  it('checks actual local KV size enforcement and records its immediate consistency behavior', async () => {
    const mf = await setup(),
      kv = await mf.getKVNamespace('ORIGINALS');
    await expect(kv.put('oversized', Buffer.alloc(25 * MiB + 1))).rejects.toThrow();
    await kv.put('same-key', tiny);
    await kv.put('same-key', tiny);
    expect(hash(Buffer.from(await kv.get('same-key', 'arrayBuffer')))).toBe(hash(tiny));
    await writeFile(
      resolve(scratch, 'kv-emulator-limits.json'),
      JSON.stringify(
        {
          valueOver25MiBRejected: true,
          consecutiveSameKeyWritesAllowed: true,
          immediateReadAfterWrite: true,
          scope:
            'Observed local emulator only; NOT production propagation, per-key rate or account quota evidence.',
        },
        null,
        2,
      ) + '\n',
    );
  });
  it('cannot be used through an unrelated hostname or without explicit local opt-in', async () => {
    const mf = await setup();
    expect((await mf.dispatchFetch('http://example.com/objects/test/begin')).status).toBe(403);
    const disabled = await setup({ enabled: false });
    expect(
      (await disabled.dispatchFetch('http://local-research.invalid/objects/test/begin')).status,
    ).toBe(403);
  });
  it('models SQL write exhaustion as private pending state and unavailable cleanup', async () => {
    const mf = await setup({ caps: { sqlWriteCalls: 3 } }),
      c = client(mf);
    await c.begin('sqlite', [tiny, tiny]);
    expect((await c.part(0, 0, tiny)).status).toBe(503);
    expect((await c.status()).state).toBe('pending');
    expect((await c.call('/images/0')).status).toBe(404);
    expect((await c.erase()).status).toBe(503);
  });
  it('records the unresolved active-takedown gap when every SQL write is exhausted', async () => {
    const mf = await setup({ caps: { sqlWriteCalls: 7 } }),
      c = client(mf);
    await c.begin('sqlite', [tiny, tiny]);
    await putAll(c, [tiny, tiny]);
    expect((await c.finalize()).status).toBe(200);
    expect((await c.erase()).status).toBe(503);
    // Expected LIMITATION, not an acceptance requirement: a failed durable
    // tombstone cannot be hidden reliably by a volatile in-memory flag.
    expect((await c.call('/manifest')).status).toBe(200);
    await writeFile(
      resolve(scratch, 'exhausted-takedown-gap.json'),
      JSON.stringify(
        {
          scope: 'Injected SQL write-call exhaustion, not an observed Cloudflare outage.',
          activePublication: true,
          deleteStatus: 503,
          stillReadable: true,
          productionAcceptance: false,
          requiredMitigation:
            'Independent fail-closed visibility/edge refusal and protected deletion capacity; not implemented in this storage prototype.',
        },
        null,
        2,
      ) + '\n',
    );
  });
  it('records the actual local SQLite BLOB boundary separately from the application part limit', async () => {
    const mf = await setup(),
      c = client(mf);
    await c.begin('sqlite', [tiny, tiny]);
    const cases = [];
    for (const bytes of [MiB, 2000000, 2 * MiB, 2 * MiB + 1]) {
      const r = await c.call('/sql-limit', 'POST', Buffer.alloc(bytes));
      expect(r.status).toBe(200);
      cases.push(await r.json());
    }
    expect(cases[0].accepted).toBe(true);
    expect(cases.every((c) => typeof c.accepted === 'boolean')).toBe(true);
    await writeFile(
      resolve(scratch, 'sqlite-emulator-limits.json'),
      JSON.stringify(
        {
          scope:
            'Actual local workerd SQL BLOB acceptance, not provider plan or account-storage proof.',
          cases,
        },
        null,
        2,
      ) + '\n',
    );
  });
});
