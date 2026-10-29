import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  LOCAL_VERIFICATION_SECRET,
  VerificationService,
  type VerificationMode,
} from '../fixtures/verification';
import { emptyImageMetadata, emptyMetadata } from '../../shared/model';
import { publicationHeaders } from '../../shared/publication';
import { testPublicationCredentials } from '../fixtures/publication';
import { configureTestCostControls, migrateTestDatabase } from '../fixtures/database';
import { rasterPng } from '../fixtures/png';

let mf: Miniflare;
const verification = new VerificationService('localhost');
const origin = 'http://localhost:5173';
const options = (enabled = true, secret = LOCAL_VERIFICATION_SECRET) =>
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
      ...(enabled && secret ? { TURNSTILE_SECRET: secret } : {}),
    },
    outboundService: verification.fetch,
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
  await configureTestCostControls(await mf.getD1Database('DB'));
  verification.reset();
  await mf.setOptions(options());
  const bucket = await mf.getR2Bucket('IMAGES');
  const objects = (await bucket.list()).objects;
  if (objects.length) await bucket.delete(objects.map((object) => object.key));
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
  const response = await upload(headers, 'valid-once');
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(await (await recover(headers)).json()).toEqual(result);
  expect(await (await upload(headers, 'valid-once')).json()).toEqual(result);
  expect(verification.requests.length).toBe(1);
  expect(
    (await upload(publicationHeaders(testPublicationCredentials()), 'valid-once')).status,
  ).toBe(403);
  expect(verification.requests.length).toBe(2);
});
it('can retry a rejected challenge with the same identity and a fresh token', async () => {
  const headers = publicationHeaders(testPublicationCredentials());
  expect((await upload(headers, 'expired')).status).toBe(403);
  expect((await recover(headers)).status).toBe(404);
  expect((await upload(headers, 'valid-retry')).status).toBe(201);
  expect(verification.requests.length).toBe(2);
});
it('allows private result recovery while uploads and production verification are disabled', async () => {
  const headers = publicationHeaders(testPublicationCredentials());
  const response = await upload(headers, 'valid-disabled');
  expect(response.status).toBe(201);
  const result = await response.json();
  await mf.setOptions(options(false));
  expect(await (await recover(headers)).json()).toEqual(result);
  expect((await upload(headers, 'valid-disabled')).status).toBe(503);
  expect(verification.requests.length).toBe(1);
});

it.each<[VerificationMode, number]>([
  ['wrong-host', 403],
  ['wrong-action', 403],
  ['not-boolean', 403],
  ['http-error', 503],
  ['redirect', 503],
  ['malformed', 503],
  ['network-error', 503],
  ['timeout', 503],
])(
  'fails closed for provider result %s without storing originals or markers',
  async (mode, status) => {
    verification.mode = mode;
    expect(
      (await upload(publicationHeaders(testPublicationCredentials()), 'valid-guard')).status,
    ).toBe(status);
    const db = await mf.getD1Database('DB');
    expect(await db.prepare('SELECT used_bytes, comparisons FROM quota').first()).toEqual({
      used_bytes: 0,
      comparisons: 0,
    });
    expect((await db.prepare('SELECT * FROM comparisons').all()).results).toHaveLength(0);
    expect((await db.prepare('SELECT * FROM publication_requests').all()).results).toHaveLength(0);
    expect((await (await mf.getR2Bucket('IMAGES')).list()).objects).toHaveLength(0);
    expect(verification.requests).toHaveLength(1);
    expect(verification.requests[0].correctSecret).toBe(true);
  },
);
it('refuses an empty token before contacting the provider', async () => {
  expect((await upload(publicationHeaders(testPublicationCredentials()), '')).status).toBe(403);
  expect(verification.requests).toHaveLength(0);
});
it('reports publishing disabled when its production verification secret is missing', async () => {
  await mf.setOptions(options(true, ''));
  expect(await (await mf.dispatchFetch('http://localhost/api/health')).json()).toMatchObject({
    verificationRequired: true,
    uploadsEnabled: false,
  });
  expect(
    (await upload(publicationHeaders(testPublicationCredentials()), 'valid-unconfigured')).status,
  ).toBe(503);
  expect(verification.requests).toHaveLength(0);
});
it('rejects a disallowed production origin before verification and upload accounting', async () => {
  expect(
    (
      await upload(
        { ...publicationHeaders(testPublicationCredentials()), Origin: 'https://other.example' },
        'valid-origin',
      )
    ).status,
  ).toBe(403);
  expect(verification.requests).toHaveLength(0);
  expect(
    (await (await mf.getD1Database('DB')).prepare('SELECT * FROM daily_usage').all()).results,
  ).toHaveLength(0);
});
