import type { D1Database, R2Bucket, ScheduledEvent } from '@cloudflare/workers-types';
import {
  MAX_DIMENSION,
  MAX_FILE_BYTES,
  MAX_PIXELS,
  manifestSchema,
  type PublicComparison,
} from '../../shared/model';
import { validateImage } from './image-validation';
import { comparisonErrorPage } from './error-page';
import { MAX_UPLOAD_BYTES, readUpload, UploadError, UploadGate } from './upload';
import { publicationFingerprint, sha256 } from '../../shared/publication';
import { findPublication, readPublicationCredentials } from './publication-retry';
import {
  eraseComparison,
  PublicationError,
  saveComparison,
  sweepComparisons,
  type ComparisonRow,
} from './publication-store';

const uploadGate = new UploadGate();

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ENVIRONMENT: string;
  UPLOADS_ENABLED: string;
  ALLOWED_ORIGINS: string;
  FRONTEND_URL: string;
  MAX_FILE_BYTES: string;
  MAX_TOTAL_BYTES: string;
  MAX_DIMENSION: string;
  MAX_PIXELS: string;
  MAX_STORAGE_BYTES: string;
  MAX_COMPARISONS: string;
  PUBLISHES_PER_HOUR: string;
  READS_PER_MINUTE: string;
  TURNSTILE_SECRET?: string;
  ADMIN_TOKEN?: string;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const numeric = (value: string | undefined, fallback: number) =>
  value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : fallback;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const random = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
async function hash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
async function secureEqual(left: string, right: string) {
  const [a, b] = await Promise.all([hash(left), hash(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
const imageKey = (id: string, index: number) => `comparisons/${id}/${index}`;
async function throttle(
  env: Env,
  request: Request,
  category: string,
  limit: number,
  windowSeconds: number,
) {
  const now = Math.floor(Date.now() / 1000),
    period = Math.floor(now / windowSeconds);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = `${category}:${period}:${await hash(ip)}`;
  const result = await env.DB.prepare(
    'INSERT INTO rate_limits (key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = hits + 1 RETURNING hits',
  )
    .bind(key, (period + 1) * windowSeconds)
    .first<{ hits: number }>();
  if (!result || result.hits > limit) fail(429, 'Too many requests. Please try again later.');
}
async function challenge(env: Env, request: Request, token: string) {
  if (env.ENVIRONMENT === 'development') return;
  if (!env.TURNSTILE_SECRET)
    fail(503, 'Publishing is not configured. Please contact the site operator.');
  if (!token || token.length > 2048) fail(403, 'Complete the verification before publishing.');
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET!);
  form.set('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  const result = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    action?: string;
  };
  const hosts = env.ALLOWED_ORIGINS.split(',').map((origin) => new URL(origin.trim()).hostname);
  if (
    !result.success ||
    !result.hostname ||
    !hosts.includes(result.hostname) ||
    result.action !== 'publish'
  )
    fail(403, 'Verification failed or expired. Please try again.');
}
async function publish(request: Request, env: Env) {
  if (env.UPLOADS_ENABLED !== 'true')
    fail(503, 'Public uploads are currently disabled. Local comparisons still work.');
  if (env.ENVIRONMENT !== 'development' && !env.TURNSTILE_SECRET)
    fail(503, 'Publishing is not configured.');
  await throttle(env, request, 'publish', numeric(env.PUBLISHES_PER_HOUR, 10), 3600);
  const intent = await readPublicationCredentials(request);
  const totalLimit = Math.min(numeric(env.MAX_TOTAL_BYTES, MAX_UPLOAD_BYTES), MAX_UPLOAD_BYTES);
  const fileLimit = Math.min(numeric(env.MAX_FILE_BYTES, MAX_FILE_BYTES), MAX_FILE_BYTES);
  const form = await readUpload(request, { maxFileBytes: fileLimit, maxTotalBytes: totalLimit });
  const raw = form.manifest;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    return fail(400, 'Invalid comparison metadata JSON.');
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) fail(400, 'Invalid comparison configuration or metadata.');
  const manifest = result.data!;
  const uploads = form.images;
  if (uploads.length !== manifest.images.length)
    fail(400, 'Upload between two and four matching image files.');
  const digests = [];
  for (const file of uploads)
    digests.push({ type: file.type, size: file.bytes.byteLength, hash: await sha256(file.bytes) });
  intent.requestHash = await publicationFingerprint(manifest, digests);
  const existing = await findPublication(env.DB, intent);
  if (existing) return publicationResponse(existing, request);
  await challenge(env, request, form.challenge);
  const stored: PublicComparison['images'] = [];
  // Validate sequentially to bound memory usage. Original bytes are never re-encoded.
  for (let i = 0; i < uploads.length; i++) {
    const file = uploads[i];
    let info;
    try {
      info = await validateImage(file.bytes, {
        maxFileBytes: fileLimit,
        maxDimension: Math.min(numeric(env.MAX_DIMENSION, MAX_DIMENSION), MAX_DIMENSION),
        maxPixels: Math.min(numeric(env.MAX_PIXELS, MAX_PIXELS), MAX_PIXELS),
      });
    } catch (error) {
      return fail(415, error instanceof Error ? error.message : 'Image validation failed.');
    }
    if (file.type !== info.type)
      fail(415, 'The image content does not match its declared media type.');
    const extension = info.type === 'image/jpeg' ? 'jpg' : info.type.split('/')[1];
    stored.push({
      ...manifest.images[i],
      ...info,
      size: file.bytes.byteLength,
      name: `screenshot-${i + 1}.${extension}`,
    });
  }
  const id = random(8),
    createdAt = new Date().toISOString();
  const payload: PublicComparison = { id, createdAt, ...manifest, images: stored };
  const saved = await saveComparison(
    env,
    payload,
    intent.digest,
    uploads,
    {
      maxStorageBytes: numeric(env.MAX_STORAGE_BYTES, 5 * 1024 ** 3),
      maxComparisons: numeric(env.MAX_COMPARISONS, 1000),
    },
    intent,
  );
  return publicationResponse(saved, request);
}
function publicationResponse(
  result: { status: 'active'; id: string } | { status: 'pending' },
  request: Request,
  status = 201,
) {
  if (result.status === 'pending')
    return Response.json(result, { status: 202, headers: { 'Retry-After': '3' } });
  return json({ ...result, shareUrl: `${new URL(request.url).origin}/s/${result.id}` }, status);
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    origin = request.headers.get('Origin');
  const origins = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
  if (origin && !origins.includes(origin)) fail(403, 'This origin is not allowed.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (url.pathname === '/api/health' && request.method === 'GET')
    return json({
      status: 'ok',
      uploadsEnabled: env.UPLOADS_ENABLED === 'true',
      verificationRequired: env.ENVIRONMENT !== 'development',
    });
  if (url.pathname === '/api/comparisons' && request.method === 'POST') {
    if (!origin || !origins.includes(origin))
      fail(403, 'Publishing requires an allowed website origin.');
    return uploadGate.run(() => publish(request, env), request.signal);
  }
  if (url.pathname === '/api/publications/result' && request.method === 'POST') {
    if (!origin || !origins.includes(origin))
      fail(403, 'Recovery requires an allowed website origin.');
    const intent = await readPublicationCredentials(request);
    await throttle(env, request, 'recover', 20, 60);
    const result = await findPublication(env.DB, intent);
    if (!result) fail(404, 'No publication was found for these credentials.');
    return publicationResponse(result!, request, 200);
  }
  const match = url.pathname.match(
    /^\/(api\/comparisons|s)\/([a-f0-9]{16})(?:\/images\/([0-3]))?$/,
  );
  if (!match)
    return fail(404, 'Comparison not found. It may have been deleted or the link is invalid.');
  const [, prefix, id, index] = match;
  if (!['GET', 'HEAD', 'DELETE'].includes(request.method)) fail(405, 'Method not allowed.');
  if (request.method === 'DELETE' && (prefix !== 'api/comparisons' || index !== undefined))
    fail(405, 'Method not allowed.');
  await throttle(
    env,
    request,
    request.method === 'DELETE' ? 'delete' : 'read',
    request.method === 'DELETE' ? 20 : numeric(env.READS_PER_MINUTE, 240),
    60,
  );
  const row = await env.DB.prepare('SELECT * FROM comparisons WHERE id = ?')
    .bind(id)
    .first<ComparisonRow>();
  if (!row || (request.method !== 'DELETE' && row.status !== 'active'))
    fail(404, 'Comparison not found. It may have been deleted or the link is invalid.');
  if (request.method === 'DELETE') {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (
      !token ||
      token.length > 256 ||
      (!(await secureEqual(await hash(token), row!.delete_hash)) &&
        !(env.ADMIN_TOKEN && (await secureEqual(token, env.ADMIN_TOKEN))))
    )
      fail(403, 'A valid private deletion key is required.');
    await eraseComparison(env, row!);
    return new Response(null, { status: 204 });
  }
  const comparison = JSON.parse(row!.payload) as PublicComparison;
  if (index !== undefined) {
    const image = comparison.images[Number(index)];
    if (!image) fail(404, 'Image not found.');
    const object = await env.IMAGES.get(imageKey(id, Number(index)));
    if (!object) fail(404, 'Image not found.');
    return new Response(request.method === 'HEAD' ? null : object!.body, {
      headers: {
        'Content-Type': image!.type,
        'Content-Length': String(image!.size),
        'Content-Disposition': `inline; filename="${image!.name}"`,
        // Check the database on every request so deletion takes effect immediately.
        'Cache-Control': 'no-store',
        ETag: object!.httpEtag,
      },
    });
  }
  if (prefix === 's') {
    const title = comparison.metadata.game
      ? `${comparison.metadata.game} — Upscale Compare`
      : 'Upscale Compare';
    const description =
      comparison.metadata.description ||
      `${comparison.images[comparison.config.selected[0]].label} vs ${comparison.images[comparison.config.selected[1]].label}`;
    const target = `${env.FRONTEND_URL.replace(/#.*$/, '').replace(/\/?$/, '/')}#c/${id}`;
    const imageUrl = `${url.origin}/api/comparisons/${id}/images/${comparison.config.selected[0]}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${escapeHtml(imageUrl)}"><meta property="og:url" content="${escapeHtml(url.origin + '/s/' + id)}"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"></head><body><a href="${escapeHtml(target)}">Open comparison in Upscale Compare</a></body></html>`;
    return new Response(request.method === 'HEAD' ? null : html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return request.method === 'HEAD' ? new Response(null) : json(comparison);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      const expected =
        error instanceof HttpError ||
        error instanceof UploadError ||
        error instanceof PublicationError;
      const status = expected ? error.status : 503;
      const message = expected
        ? error.message
        : 'The sharing service is temporarily unavailable. Please try again later.';
      response = new URL(request.url).pathname.startsWith('/s/')
        ? comparisonErrorPage(status, message, env.FRONTEND_URL)
        : json({ error: message }, status);
    } finally {
      // Includes refused admission and malformed headers rejected before reading.
      if (request.method === 'POST' && request.body && !request.body.locked)
        void request.body.cancel().catch(() => undefined);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set(
      'Content-Security-Policy',
      `default-src 'none'; ${headers.get('Content-Type')?.startsWith('text/html') ? "style-src 'unsafe-inline'; " : ''}frame-ancestors 'none'; base-uri 'none'`,
    );
    headers.set('Cache-Control', 'no-store');
    if (new URL(request.url).protocol === 'https:')
      headers.set('Strict-Transport-Security', 'max-age=31536000');
    const origin = request.headers.get('Origin');
    if (
      origin &&
      env.ALLOWED_ORIGINS.split(',')
        .map((value) => value.trim())
        .includes(origin)
    )
      headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
    if (response.status === 429) headers.set('Retry-After', '60');
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event: ScheduledEvent, env: Env) {
    await sweepComparisons(env);
  },
};
