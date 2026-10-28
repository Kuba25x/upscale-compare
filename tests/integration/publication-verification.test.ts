import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare, Response as LocalResponse, convertV4MiniflareOptions } from 'miniflare';
import { emptyImageMetadata, emptyMetadata } from '../../shared/model';
import { publicationHeaders } from '../../shared/publication';
import { testPublicationCredentials } from '../fixtures/publication';
import { migrateTestDatabase } from '../fixtures/database';
import { rasterPng } from '../fixtures/png';

let mf: Miniflare,
  verificationCalls = 0;
const origin = 'http://localhost:5173';
const consumed = new Set<string>();
const options = (enabled = true) =>
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: 'worker/dist/index.js',
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    r2Buckets: ['IMAGES'],
    bindings: {
      ENVIRONMENT: 'production',
      UPLOADS_ENABLED: String(enabled),
      ALLOWED_ORIGINS: origin,
      FRONTEND_URL: origin,
      ...(enabled ? { TURNSTILE_SECRET: 'local-test-secret' } : {}),
    },
    // Local transport fake, not the real Turnstile service or a production bypass.
    outboundService: async (request) => {
      expect(request.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      verificationCalls++;
      const token = String((await request.formData()).get('response'));
      const success = token.startsWith('fresh-') && !consumed.has(token);
      consumed.add(token);
      return new LocalResponse(
        JSON.stringify({ success, hostname: 'localhost', action: 'publish' }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
async function upload(headers: Record<string, string>, token: string) {
  const body = new FormData();
  body.set(
    'manifest',
    JSON.stringify({
      metadata: emptyMetadata(),
      images: ['A', 'B'].map((label) => ({ label, metadata: emptyImageMetadata() })),
      config: {
        mode: 'split',
        selected: [0, 1],
        divider: 0.5,
        view: { zoom: null, center: { x: 8, y: 6 } },
      },
    }),
  );
  body.set('challenge', token);
  for (let i = 0; i < 2; i++)
    body.append('images', new File([rasterPng(16, 12)], 'screenshot.png', { type: 'image/png' }));
  const request = new Request('http://localhost/api/comparisons', {
    method: 'POST',
    headers: { Origin: origin, ...headers },
    body,
  });
  return mf.dispatchFetch(request.url, {
    method: 'POST',
    headers: Object.fromEntries(request.headers),
    body: await request.arrayBuffer(),
  });
}
const recover = (headers: Record<string, string>) =>
  mf.dispatchFetch('http://localhost/api/publications/result', {
    method: 'POST',
    headers: { Origin: origin, ...headers },
  });
beforeAll(async () => {
  mf = new Miniflare(options());
  await migrateTestDatabase(await mf.getD1Database('DB'));
});
beforeEach(async () => {
  verificationCalls = 0;
  consumed.clear();
  await mf.setOptions(options());
  await (
    await mf.getD1Database('DB')
  ).exec(
    'DELETE FROM comparisons; DELETE FROM publication_requests; DELETE FROM rate_limits; UPDATE quota SET used_bytes = 0, comparisons = 0;',
  );
});
afterAll(async () => {
  await mf?.dispose();
});
it('requires verification for a new publication but not for result recovery or matching retries', async () => {
  const headers = publicationHeaders(testPublicationCredentials());
  const response = await upload(headers, 'fresh-once');
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(await (await recover(headers)).json()).toEqual(result);
  expect(await (await upload(headers, 'fresh-once')).json()).toEqual(result);
  expect(verificationCalls).toBe(1);
  expect(
    (await upload(publicationHeaders(testPublicationCredentials()), 'fresh-once')).status,
  ).toBe(403);
  expect(verificationCalls).toBe(2);
});
it('can retry a rejected challenge with the same identity and a fresh token', async () => {
  const headers = publicationHeaders(testPublicationCredentials());
  expect((await upload(headers, 'expired')).status).toBe(403);
  expect((await recover(headers)).status).toBe(404);
  expect((await upload(headers, 'fresh-retry')).status).toBe(201);
  expect(verificationCalls).toBe(2);
});
it('allows private result recovery while uploads and production verification are disabled', async () => {
  const headers = publicationHeaders(testPublicationCredentials());
  const response = await upload(headers, 'fresh-disabled');
  expect(response.status).toBe(201);
  const result = await response.json();
  await mf.setOptions(options(false));
  expect(await (await recover(headers)).json()).toEqual(result);
  expect((await upload(headers, 'fresh-disabled')).status).toBe(503);
  expect(verificationCalls).toBe(1);
});
