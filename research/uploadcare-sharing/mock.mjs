import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { APP_ORIGIN, FIXTURE_NAMES, MOCK_PUBLIC_KEY, UUID } from './settings.ts';

const PERMIT_TTL_MS = 2 * 60 * 1000;
const FILE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_FILES = 64;
const MAX_PERMITS = 64;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const length = Number(request.headers['content-length']);
  if (!Number.isInteger(length) || length <= 0 || length > MAX_BODY_BYTES) {
    throw new RequestError(413, 'Invalid mock request size.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > length) throw new RequestError(413, 'Mock body exceeds its declared size.');
    chunks.push(chunk);
  }
  if (size !== length) throw new RequestError(400, 'Incomplete mock body.');
  return Buffer.concat(chunks, size);
}

export async function createMockProvider(now = Date.now) {
  const fixtures = new Map(
    await Promise.all(
      FIXTURE_NAMES.map(async (name) => [
        name,
        await readFile(new URL(`../../tests/fixtures/fidelity/${name}`, import.meta.url)),
      ]),
    ),
  );
  const permits = new Map();
  const originals = new Map();
  function sweep() {
    const time = now();
    for (const records of [permits, originals]) {
      for (const [key, { expires }] of records) {
        if (expires <= time) records.delete(key);
      }
    }
  }

  async function handle(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    if (request.headers.origin !== APP_ORIGIN) {
      return json(response, 403, { error: 'Use the loopback experiment origin.' });
    }
    response.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);
    if (request.method === 'OPTIONS') {
      response
        .writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        })
        .end();
      return;
    }
    sweep();

    if (request.method === 'POST' && request.url === '/permit/') {
      const { files } = JSON.parse((await readBody(request)).toString('utf8'));
      if (!Number.isInteger(files) || files < 2 || files > 4) {
        throw new RequestError(400, 'A permit covers two to four fixtures.');
      }
      if (permits.size >= MAX_PERMITS) throw new RequestError(429, 'Mock permit limit reached.');
      const token = randomUUID();
      permits.set(token, { remaining: files, expires: now() + PERMIT_TTL_MS });
      return json(response, 200, { token });
    }

    if (request.method === 'POST' && request.url === '/base/') {
      const token = /^Bearer ([a-f0-9-]+)$/.exec(request.headers.authorization || '')?.[1];
      const permit = permits.get(token);
      if (!permit) throw new RequestError(401, 'A current mock permit is required.');
      const body = await readBody(request);
      const type = request.headers['content-type'] || '';
      const form = await new Response(new Uint8Array(body), {
        headers: { 'content-type': type },
      }).formData();
      const file = form.get('file');
      const fixture = file instanceof File && fixtures.get(file.name);
      if (
        [...form].length !== 3 ||
        form.get('UPLOADCARE_PUB_KEY') !== MOCK_PUBLIC_KEY ||
        form.get('UPLOADCARE_STORE') !== '0' ||
        !fixture
      ) {
        throw new RequestError(400, 'Use a temporary upload with one known synthetic fixture.');
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[
        file.name.split('.').at(-1)
      ];
      if (!bytes.equals(fixture) || file.type !== mime) {
        throw new RequestError(400, 'Only unchanged synthetic fixture bytes are accepted.');
      }
      if (permit.expires <= now()) throw new RequestError(401, 'Mock permit expired.');
      if (permit.remaining <= 0) throw new RequestError(403, 'Mock permit exhausted.');
      if (originals.size >= MAX_FILES) throw new RequestError(429, 'Mock storage limit reached.');

      permit.remaining--;
      const uuid = randomUUID();
      originals.set(uuid, { bytes, mime, expires: now() + FILE_TTL_MS });
      return json(response, 200, { file: uuid });
    }

    const uuid = /^\/([^/]+)\/$/.exec(request.url)?.[1];
    if (request.method === 'GET' && uuid && UUID.test(uuid)) {
      const file = originals.get(uuid);
      if (file) {
        response.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.bytes.length });
        response.end(file.bytes);
        return;
      }
    }
    json(response, 404, { error: 'Mock original or endpoint unavailable.' });
  }

  const server = createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000 },
    (request, response) => {
      handle(request, response).catch((error) => {
        if (response.destroyed) return;
        if (!request.complete) response.setHeader('Connection', 'close');
        const status = error instanceof RequestError ? error.status : 400;
        json(response, status, {
          error: error instanceof RequestError ? error.message : 'Invalid mock request.',
        });
      });
    },
  );
  const cleanup = setInterval(sweep, 60_000).unref();
  server.once('close', () => clearInterval(cleanup));
  return server;
}
