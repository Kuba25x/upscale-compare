import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateTestDatabase } from '../fixtures/database';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { PNG } from 'pngjs';
import { emptyMetadata, emptyImageMetadata } from '../../shared/model';
import {
  testDeletionToken,
  testPublicationCredentials,
  testPublicationHeaders,
} from '../fixtures/publication';
import { publicationHeaders, PUBLICATION_RETRY_MS } from '../../shared/publication';
let mf: Miniflare;
const origin = 'http://localhost:5173';
const png = (() => {
  const image = new PNG({ width: 16, height: 12 });
  image.data.fill(255);
  return PNG.sync.write(image);
})();
const config = {
  mode: 'side',
  selected: [1, 0],
  divider: 0.37,
  view: { zoom: 2, center: { x: 8, y: 6 } },
};
const manifest = () => ({
  metadata: { ...emptyMetadata(), game: '<Cyberpunk & friends>', description: 'A "quoted" test' },
  config,
  images: ['DLSS custom', 'FSR Quality'].map((label) => ({
    label,
    metadata: emptyImageMetadata(),
  })),
});
async function upload(
  data = manifest(),
  content: Uint8Array = png,
  type = 'image/png',
  extra: Record<string, string> = {},
) {
  const form = new FormData();
  form.set('manifest', JSON.stringify(data));
  for (let i = 0; i < data.images.length; i++)
    form.append('images', new File([content as BlobPart], `../../evil-${i}.png`, { type }));
  return sendForm(form, extra);
}
async function sendForm(form: FormData, extra: Record<string, string> = {}) {
  const request = new Request('http://localhost/api/comparisons', {
    method: 'POST',
    headers: { Origin: origin, ...testPublicationHeaders(), ...extra },
    body: form,
  });
  return mf.dispatchFetch(request.url, {
    method: 'POST',
    headers: Object.fromEntries(request.headers),
    body: await request.arrayBuffer(),
  });
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
        FRONTEND_URL: `${origin}/upscale-compare/`,
        PUBLISHES_PER_HOUR: '10',
        READS_PER_MINUTE: '240',
        MAX_TOTAL_BYTES: '2048',
        MAX_STORAGE_BYTES: '1048576',
        MAX_COMPARISONS: '10',
        ADMIN_TOKEN: 'test-admin-secret-only',
      },
    }),
  );
  await migrateTestDatabase(await mf.getD1Database('DB'));
});
beforeEach(async () => {
  const db = await mf.getD1Database('DB');
  await db.exec(
    'DELETE FROM comparisons; DELETE FROM publication_requests; DELETE FROM rate_limits; UPDATE quota SET used_bytes = 0, comparisons = 0;',
  );
});
describe('recoverable publication protocol', () => {
  const recover = (headers: Record<string, string>) =>
    mf.dispatchFetch('http://localhost/api/publications/result', {
      method: 'POST',
      headers: { Origin: origin, ...headers },
    });
  it('recovers a discarded response with no images or challenge and repeats the same result', async () => {
    const credentials = testPublicationCredentials(),
      headers = publicationHeaders(credentials);
    expect((await recover(headers)).status).toBe(404);
    const original = await upload(manifest(), png, 'image/png', headers);
    const result = await original.json();
    const recovered = await recover(headers);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual(result);
    expect(await (await upload(manifest(), png, 'image/png', headers)).json()).toEqual(result);
    expect(
      await (await mf.getD1Database('DB')).prepare('SELECT comparisons FROM quota').first(),
    ).toEqual({ comparisons: 1 });
    expect((await (await mf.getR2Bucket('IMAGES')).list()).objects).toHaveLength(2);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(credentials.key);
    expect(serialized).not.toContain(credentials.deleteToken);
    const stored = JSON.stringify(
      (await (await mf.getD1Database('DB')).prepare('SELECT * FROM publication_requests').all())
        .results,
    );
    expect(stored).not.toContain(credentials.key);
    expect(stored).not.toContain(credentials.deleteToken);
  });
  it('normalizes metadata and ignores transport filenames and challenge tokens on matching retries', async () => {
    const headers = testPublicationHeaders();
    const first = await (await upload(manifest(), png, 'image/png', headers)).json();
    const data = manifest();
    data.images[0].label = '  DLSS custom  ';
    const form = new FormData();
    form.set('manifest', JSON.stringify(data));
    form.set('challenge', 'different-single-use-token');
    for (let i = 0; i < 2; i++)
      form.append(
        'images',
        new File([new Uint8Array(png)], 'renamed-file.png', { type: 'image/png' }),
      );
    expect(await (await sendForm(form, headers)).json()).toEqual(first);
  });
  it.each(['metadata', 'configuration', 'label', 'image bytes', 'media type', 'image order'])(
    'rejects reuse for changed %s without changing the first publication',
    async (change) => {
      const headers = testPublicationHeaders();
      const first = (await (await upload(manifest(), png, 'image/png', headers)).json()) as any;
      const modified = manifest();
      let content = png,
        type = 'image/png';
      if (change === 'metadata') modified.metadata.game = 'Different';
      if (change === 'configuration') modified.config = { ...config, divider: 0.6 };
      if (change === 'label') modified.images[0].label = 'Different';
      if (change === 'image bytes') content = Buffer.concat([png, Buffer.from([1])]);
      if (change === 'media type') type = 'image/jpeg';
      if (change === 'image order') modified.images.reverse();
      expect((await upload(modified, content, type, headers)).status).toBe(409);
      expect((await mf.dispatchFetch('http://localhost/api/comparisons/' + first.id)).status).toBe(
        200,
      );
      expect(
        await (await mf.getD1Database('DB')).prepare('SELECT comparisons FROM quota').first(),
      ).toEqual({ comparisons: 1 });
    },
  );
  it('does not expose a result to an identifier without its private deletion key', async () => {
    const headers = testPublicationHeaders();
    await upload(manifest(), png, 'image/png', headers);
    expect((await recover({ ...headers, Authorization: 'Bearer ' + 'cd'.repeat(32) })).status).toBe(
      404,
    );
    expect(
      (
        await upload(manifest(), png, 'image/png', {
          ...headers,
          Authorization: 'Bearer ' + 'cd'.repeat(32),
        })
      ).status,
    ).toBe(404);
    expect((await recover({ 'Idempotency-Key': headers['Idempotency-Key'] })).status).toBe(400);
  });
  it('returns pending without activating or rewriting an interrupted upload', async () => {
    const headers = testPublicationHeaders();
    const { id } = (await (await upload(manifest(), png, 'image/png', headers)).json()) as any;
    await (
      await mf.getD1Database('DB')
    )
      .prepare("UPDATE comparisons SET status = 'pending' WHERE id = ?")
      .bind(id)
      .run();
    const result = await recover(headers);
    expect(result.status).toBe(202);
    expect(result.headers.get('retry-after')).toBe('3');
    expect(await result.json()).toEqual({ status: 'pending' });
    expect((await upload(manifest(), png, 'image/png', headers)).status).toBe(202);
    expect((await mf.dispatchFetch('http://localhost/api/comparisons/' + id)).status).toBe(404);
  });
  it('keeps a tombstone after deletion and refuses resurrection with the same identifier', async () => {
    const credentials = testPublicationCredentials(),
      headers = publicationHeaders(credentials);
    const { id } = (await (await upload(manifest(), png, 'image/png', headers)).json()) as any;
    await mf.dispatchFetch('http://localhost/api/comparisons/' + id, { method: 'DELETE', headers });
    expect((await recover(headers)).status).toBe(410);
    expect((await upload(manifest(), png, 'image/png', headers)).status).toBe(410);
    expect(
      await (
        await mf.getD1Database('DB')
      )
        .prepare('SELECT used_bytes, comparisons FROM quota')
        .first(),
    ).toEqual({ used_bytes: 0, comparisons: 0 });
    expect(
      (await (await mf.getD1Database('DB')).prepare('SELECT * FROM publication_requests').all())
        .results,
    ).toHaveLength(1);
  });
  it.each(['missing', 'invalid', 'expired', 'future'])(
    'refuses %s credentials before storage reservation',
    async (kind) => {
      const headers = testPublicationHeaders();
      if (kind === 'missing') headers['Idempotency-Key'] = '';
      if (kind === 'invalid') headers['Idempotency-Key'] = 'abc';
      if (kind === 'expired')
        headers['Idempotency-Key'] = `${Date.now() - PUBLICATION_RETRY_MS - 1}.${'ef'.repeat(32)}`;
      if (kind === 'future')
        headers['Idempotency-Key'] = `${Date.now() + 3600000}.${'ef'.repeat(32)}`;
      expect((await upload(manifest(), png, 'image/png', headers)).status).toBe(
        kind === 'expired' ? 410 : 400,
      );
      expect(
        await (await mf.getD1Database('DB')).prepare('SELECT comparisons FROM quota').first(),
      ).toEqual({ comparisons: 0 });
    },
  );
  it('requires an allowed origin for recovery and allows both private headers in CORS', async () => {
    expect(
      (
        await mf.dispatchFetch('http://localhost/api/publications/result', {
          method: 'POST',
          headers: testPublicationHeaders(),
        })
      ).status,
    ).toBe(403);
    expect(
      (await recover({ ...testPublicationHeaders(), Origin: 'https://evil.example' })).status,
    ).toBe(403);
    const response = await mf.dispatchFetch('http://localhost/api/publications/result', {
      method: 'OPTIONS',
      headers: { Origin: origin },
    });
    expect(response.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('limits recovery separately so exhausted upload attempts cannot block recovery', async () => {
    const headers = testPublicationHeaders();
    const expected = await (await upload(manifest(), png, 'image/png', headers)).json();
    for (let i = 0; i < 9; i++) await upload(manifest(), new Uint8Array([1]), 'image/png');
    expect((await upload(manifest(), png, 'image/png', headers)).status).toBe(429);
    expect(await (await recover(headers)).json()).toEqual(expected);
    for (let i = 1; i < 20; i++) expect((await recover(headers)).status).toBe(200);
    expect((await recover(headers)).status).toBe(429);
  });
});
afterAll(async () => {
  await mf?.dispose();
});
describe('Cloudflare Worker with real local D1 and R2', () => {
  it('publishes originals, restores the configuration, and returns safe image headers', async () => {
    const response = await upload();
    expect(response.status).toBe(201);
    const published = (await response.json()) as {
      id: string;
      deleteToken: string;
      shareUrl: string;
    };
    expect(published.id).toMatch(/^[a-f0-9]{16}$/);
    expect(published.deleteToken).toBeUndefined();
    const restored = (await (
      await mf.dispatchFetch(`http://localhost/api/comparisons/${published.id}`)
    ).json()) as any;
    expect(restored.config).toEqual(config);
    expect(restored.images[0].label).toBe('DLSS custom');
    expect(restored.deleteToken).toBeUndefined();
    expect(restored.images[0].name).toBe('screenshot-1.png');
    const image = await mf.dispatchFetch(
      `http://localhost/api/comparisons/${published.id}/images/0`,
    );
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(image.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
  });
  it('serves escaped Open Graph metadata and a subpath-safe redirect', async () => {
    const { id } = (await (await upload()).json()) as any;
    const response = await mf.dispatchFetch(`http://localhost/s/${id}`),
      html = await response.text();
    expect(html).toContain('&lt;Cyberpunk &amp; friends&gt;');
    expect(html).toContain('&quot;quoted&quot;');
    expect(html).toContain(`/upscale-compare/#c/${id}`);
    expect(html).toContain('og:image');
  });
  it('requires the deletion key, removes images and releases quota', async () => {
    const { id } = (await (await upload()).json()) as any;
    const deleteToken = testDeletionToken;
    expect(
      (
        await mf.dispatchFetch(`http://localhost/api/comparisons/${id}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await mf.dispatchFetch(`http://localhost/api/comparisons/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${deleteToken}` },
        })
      ).status,
    ).toBe(204);
    expect((await mf.dispatchFetch(`http://localhost/api/comparisons/${id}`)).status).toBe(404);
    expect((await mf.dispatchFetch(`http://localhost/api/comparisons/${id}/images/0`)).status).toBe(
      404,
    );
    expect(
      await (
        await mf.getD1Database('DB')
      )
        .prepare('SELECT used_bytes, comparisons FROM quota')
        .first(),
    ).toEqual({ used_bytes: 0, comparisons: 0 });
    expect(
      (
        await mf.dispatchFetch(`http://localhost/api/comparisons/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${deleteToken}` },
        })
      ).status,
    ).toBe(404);
  });
  it('allows operator moderation with the admin secret', async () => {
    const { id } = (await (await upload()).json()) as any;
    expect(
      (
        await mf.dispatchFetch(`http://localhost/api/comparisons/${id}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer test-admin-secret-only' },
        })
      ).status,
    ).toBe(204);
  });
  it('rejects an untrusted origin and missing origins on publish', async () => {
    expect(
      (await upload(manifest(), png, 'image/png', { Origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (await mf.dispatchFetch('http://localhost/api/comparisons', { method: 'POST' })).status,
    ).toBe(403);
  });
  it('returns exact CORS origins without credentials', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/health', {
      headers: { Origin: origin },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });
  it('rejects spoofed file types and HTML uploads', async () => {
    expect((await upload(manifest(), png, 'image/jpeg')).status).toBe(415);
    expect(
      (await upload(manifest(), new TextEncoder().encode('<script>alert(1)</script>'))).status,
    ).toBe(415);
  });
  it('rejects invalid configuration, huge labels, and malformed JSON', async () => {
    const data = manifest();
    data.images[0].label = 'x'.repeat(121);
    expect((await upload(data)).status).toBe(400);
    const invalid = manifest();
    invalid.config = { ...config, selected: [3, 0] };
    expect((await upload(invalid)).status).toBe(400);
    const form = new FormData();
    form.set('manifest', '{');
    expect((await sendForm(form)).status).toBe(400);
  });
  it('rejects incorrect counts and multipart types', async () => {
    const data = manifest();
    data.images.pop();
    expect((await upload(data)).status).toBe(400);
    expect(
      (
        await mf.dispatchFetch('http://localhost/api/comparisons', {
          method: 'POST',
          headers: {
            Origin: origin,
            ...testPublicationHeaders(),
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
    ).toBe(415);
  });
  it('enforces actual request size before multipart parsing', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/comparisons', {
      method: 'POST',
      headers: {
        Origin: origin,
        ...testPublicationHeaders(),
        'Content-Type': 'multipart/form-data; boundary=x',
      },
      body: 'x'.repeat(70000),
    });
    expect(response.status).toBe(413);
  });
  it('atomically refuses publication when storage is full', async () => {
    await (await mf.getD1Database('DB')).prepare('UPDATE quota SET used_bytes = 1048576').run();
    expect((await upload()).status).toBe(507);
    expect(
      (
        (await (
          await mf.getD1Database('DB')
        )
          .prepare('SELECT COUNT(*) AS count FROM comparisons')
          .first()) as any
      ).count,
    ).toBe(0);
  });
  it('limits repeated automated publishing attempts', async () => {
    for (let i = 0; i < 10; i++)
      expect((await upload(manifest(), new Uint8Array([1, 2, 3]))).status).toBe(415);
    expect((await upload()).status).toBe(429);
  });
  it('returns useful errors for invalid IDs and missing comparisons', async () => {
    for (const id of ['invalid', 'a'.repeat(16)]) {
      const response = await mf.dispatchFetch(`http://localhost/api/comparisons/${id}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('Comparison not found');
    }
  });
  it('keeps global quota correct under concurrent publication attempts', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare('UPDATE quota SET comparisons = 9').run();
    const results = await Promise.all([upload(), upload(), upload()]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 507, 507]);
    expect(((await db.prepare('SELECT comparisons FROM quota').first()) as any).comparisons).toBe(
      10,
    );
  });
  it('does not double-release quota on concurrent deletions', async () => {
    const { id } = (await (await upload()).json()) as any;
    const deleteToken = testDeletionToken;
    const deletes = await Promise.all(
      [0, 1].map(() =>
        mf.dispatchFetch(`http://localhost/api/comparisons/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${deleteToken}` },
        }),
      ),
    );
    expect(deletes.every((response) => [204, 404].includes(response.status))).toBe(true);
    expect(
      await (
        await mf.getD1Database('DB')
      )
        .prepare('SELECT used_bytes, comparisons FROM quota')
        .first(),
    ).toEqual({ used_bytes: 0, comparisons: 0 });
  });
  it('fails closed for production uploads without Turnstile configuration', async () => {
    const production = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        scriptPath: 'worker/dist/index.js',
        compatibilityDate: '2026-07-01',
        bindings: { ENVIRONMENT: 'production', UPLOADS_ENABLED: 'true', ALLOWED_ORIGINS: origin },
      }),
    );
    try {
      expect(
        (
          await production.dispatchFetch('http://localhost/api/comparisons', {
            method: 'POST',
            headers: { Origin: origin },
          })
        ).status,
      ).toBe(503);
    } finally {
      await production.dispose();
    }
  });
});
