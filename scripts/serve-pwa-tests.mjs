import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

let state = { release: 'a', fault: 'none' };
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.map': 'application/json',
};
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1:4188').pathname;
  if (path === '/__pwa_test__/state' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += chunk;
    state = { release: 'a', fault: 'none', ...JSON.parse(body) };
    response.writeHead(200).end('ok');
    return;
  }
  const base = path.startsWith('/upscale-compare/') ? '/upscale-compare/' : '/';
  const relative = decodeURIComponent(path.slice(base.length)) || 'index.html';
  const root = resolve(`.wrangler/pwa-tests/${base === '/' ? 'root' : 'pages'}-${state.release}`);
  const file = resolve(root, relative);
  if (!file.startsWith(`${root}/`)) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  if (relative.startsWith('api/')) {
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end('{"private":"not-cacheable"}');
    return;
  }
  if (state.fault === 'worker' && relative === 'sw.js') {
    response.writeHead(503).end();
    return;
  }
  try {
    const data = await readFile(file);
    // Fail only a new, release-specific B module, leaving A and shared assets usable.
    if (
      state.release === 'b' &&
      relative.endsWith('.js') &&
      relative.startsWith('assets/') &&
      data.includes('0.1.0+bbbbbbb2')
    ) {
      if (state.fault === 'network') {
        response.destroy();
        return;
      }
      if (state.fault === 'missing') {
        response.writeHead(404).end();
        return;
      }
      if (state.fault === 'corrupt') {
        response
          .writeHead(200, { 'Content-Type': 'text/javascript' })
          .end('export const corrupted = true;');
        return;
      }
    }
    response
      .writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
      .end(data);
  } catch {
    // No generic SPA fallback: the service worker must own only its entry points.
    response.writeHead(404).end('Not found');
  }
});
server.listen(4188, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
