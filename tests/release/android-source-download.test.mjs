import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSource } from '../../scripts/android-source-download.mjs';

const url = 'https://repo.maven.apache.org/maven2/dependency.pom';
const text = (response) => response.text();

function download(responses, readBody = text) {
  const delays = [];
  const calls = [];
  const result = readSource(url, readBody, {
    request: async (requestUrl, { signal }) => {
      assert.equal(requestUrl, url);
      assert.ok(signal instanceof AbortSignal);
      const response = responses[calls.length];
      calls.push(signal);
      if (response instanceof Error) throw response;
      assert.ok(response);
      return response;
    },
    sleep: async (ms) => delays.push(ms),
  });
  return { result, calls, delays };
}

test('recovers from a Maven rate limit and respects Retry-After', async () => {
  const { result, calls, delays } = download([
    new Response('rate limited', { status: 429, headers: { 'Retry-After': '3' } }),
    new Response('<project/>'),
  ]);
  assert.equal(await result, '<project/>');
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [3000]);
});

test('retries a transient connection failure and a timeout while reading the response body', async () => {
  const connection = new TypeError('fetch failed', {
    cause: Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
  });
  const interrupted = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new DOMException('The operation timed out', 'TimeoutError'));
      },
    }),
  );
  const archive = new Uint8Array([0, 1, 255, 2]);
  const { result, calls, delays } = download(
    [connection, interrupted, new Response(archive)],
    (response) => response.bytes(),
  );
  assert.deepEqual(await result, archive);
  assert.equal(new Set(calls).size, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test('fails immediately on a missing source or certificate error', async () => {
  const notFound = download([new Response(null, { status: 404 })]);
  await assert.rejects(notFound.result, /HTTP 404/);
  assert.equal(notFound.calls.length, 1);
  assert.deepEqual(notFound.delays, []);

  const tlsError = new TypeError('fetch failed', {
    cause: Object.assign(new Error('certificate expired'), { code: 'CERT_HAS_EXPIRED' }),
  });
  const invalidCertificate = download([tlsError]);
  await assert.rejects(invalidCertificate.result, /CERT_HAS_EXPIRED/);
  assert.equal(invalidCertificate.calls.length, 1);
  assert.deepEqual(invalidCertificate.delays, []);
});

test('fails once the request or Retry-After budget is exhausted', async () => {
  const unavailable = download(
    Array.from({ length: 4 }, () => new Response(null, { status: 503 })),
  );
  await assert.rejects(unavailable.result, /HTTP 503/);
  assert.equal(unavailable.calls.length, 4);
  assert.deepEqual(unavailable.delays, [1000, 2000, 4000]);

  const tooLong = download([new Response(null, { status: 429, headers: { 'Retry-After': '31' } })]);
  await assert.rejects(tooLong.result, /Retry-After exceeds/);
  assert.equal(tooLong.calls.length, 1);
  assert.deepEqual(tooLong.delays, []);
});
