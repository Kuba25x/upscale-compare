import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { PNG } from 'pngjs';
import { emptyMetadata, emptyImageMetadata } from '../../shared/model';
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
    headers: { Origin: origin, ...extra },
    body: form,
  });
  return mf.dispatchFetch(request.url, {
    method: 'POST',
    headers: Object.fromEntries(request.headers),
    body: await request.arrayBuffer(),
  });
}
beforeAll(async () => {
  mf = new Miniflare({
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
  });
  await (
    await mf.getD1Database('DB')
  ).exec((await readFile('worker/migrations/0001_initial.sql', 'utf8')).replace(/\n/g, ' '));
});
beforeEach(async () => {
  const db = await mf.getD1Database('DB');
  await db.exec(
    'DELETE FROM comparisons; DELETE FROM rate_limits; UPDATE quota SET used_bytes = 0, comparisons = 0;',
  );
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
    expect(published.deleteToken).toHaveLength(64);
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
    const { id, deleteToken } = (await (await upload()).json()) as any;
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
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
  });
  it('enforces actual request size before multipart parsing', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/comparisons', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'multipart/form-data; boundary=x' },
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
    const { id, deleteToken } = (await (await upload()).json()) as any;
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
    const production = new Miniflare({
      modules: true,
      scriptPath: 'worker/dist/index.js',
      compatibilityDate: '2026-07-01',
      bindings: { ENVIRONMENT: 'production', UPLOADS_ENABLED: 'true', ALLOWED_ORIGINS: origin },
    });
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
