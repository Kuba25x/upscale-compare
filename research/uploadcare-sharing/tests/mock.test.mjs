import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createMockProvider } from '../mock.mjs';
import { APP_ORIGIN, FIXTURE_NAMES, LOOPBACK, MOCK_PUBLIC_KEY } from '../settings.ts';

test('loopback provider restricts uploads to temporary fixtures, limits permits, and expires bytes', async (t) => {
  let now = 0;
  const server = await createMockProvider(() => now);
  await once(server.listen(0, LOOPBACK), 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://${LOOPBACK}:${server.address().port}`;
  const headers = { Origin: APP_ORIGIN };
  const permit = () =>
    fetch(origin + '/permit/', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: 2 }),
    });
  const fixture = FIXTURE_NAMES[0];
  const bytes = await readFile(
    new URL(`../../../tests/fixtures/fidelity/${fixture}`, import.meta.url),
  );
  function upload(token, contents = bytes, store = '0') {
    const body = new FormData();
    body.set('UPLOADCARE_PUB_KEY', MOCK_PUBLIC_KEY);
    body.set('UPLOADCARE_STORE', store);
    body.set('file', new Blob([contents], { type: 'image/png' }), fixture);
    return fetch(origin + '/base/', {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body,
    });
  }
  const preflight = await fetch(origin + '/base/', { method: 'OPTIONS', headers });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), APP_ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);

  const { token } = await (await permit()).json();
  assert.equal((await upload('missing')).status, 401);
  assert.equal((await upload(token, Buffer.from([0]))).status, 400);
  assert.equal((await upload(token, bytes, '1')).status, 400);
  const first = await upload(token);
  const second = await upload(token);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await upload(token)).status, 403);

  const { file } = await first.json();
  const address = origin + '/' + file + '/';
  assert.equal((await fetch(address)).status, 403);
  const original = await fetch(address, { headers });
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
  now += 2 * 60 * 1000;
  assert.equal((await upload(token)).status, 401);
  now = 24 * 60 * 60 * 1000;
  assert.equal((await fetch(address, { headers })).status, 404);
});
