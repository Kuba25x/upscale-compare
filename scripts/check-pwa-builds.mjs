import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build, createServer } from 'vite';
import { PNG } from 'pngjs';
import { runtimeNotices, workboxRuntimePackages } from './generate-notices.mjs';

const directory = await mkdtemp(join(tmpdir(), 'upscale-pwa-builds-'));
const originalBase = process.env.VITE_BASE_PATH;
after(async () => {
  if (originalBase === undefined) delete process.env.VITE_BASE_PATH;
  else process.env.VITE_BASE_PATH = originalBase;
  await rm(directory, { recursive: true, force: true });
});
const icons = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
];

function inspectWorker(source) {
  const state = { entries: [], routes: [], dependencies: [], fallback: '', claims: 0 };
  const workbox = {
    setCacheNameDetails: () => {},
    precacheAndRoute: (entries) => (state.entries = JSON.parse(JSON.stringify(entries))),
    cleanupOutdatedCaches: () => {},
    createHandlerBoundToURL: (url) => (state.fallback = url),
    NavigationRoute: class {
      constructor(handler, options) {
        this.allowlist = options.allowlist;
      }
    },
    registerRoute: (route) => state.routes.push(route),
    clientsClaim: () => state.claims++,
  };
  const define = (dependencies, factory) => {
    state.dependencies = dependencies;
    factory(workbox);
  };
  // Inspect generated code without installing or activating a real worker.
  runInNewContext(source, {
    define,
    self: { define, addEventListener: () => {}, skipWaiting: () => state.claims++ },
  });
  return state;
}

async function verifyWeb(output, base) {
  const read = (file) => readFile(join(output, file));
  const html = (await read('index.html')).toString();
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Upscale Compare');
  assert.equal(manifest.short_name, 'Upscale Compare');
  assert.equal(manifest.lang, 'en');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#101114');
  assert.equal(manifest.background_color, '#101114');
  for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], base);
  assert.equal(manifest.prefer_related_applications, false);
  assert.equal(manifest.orientation, undefined);
  assert.deepEqual(manifest.icons, [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: 'icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ]);
  assert.equal((html.match(/rel="manifest"/g) || []).length, 1);
  assert.ok(html.includes(`href="${base}manifest.webmanifest"`));
  assert.ok(html.includes(`href="${base}icons/apple-touch-icon.png"`));
  assert.ok(html.includes('sizes="180x180"'));
  assert.ok(html.includes(`href="${base}favicon.svg"`));
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, `https://example.test${base}manifest.webmanifest`);
    assert.equal(url.pathname, `${base}${icon.src}`);
  }
  for (const [file, size] of icons) {
    const image = PNG.sync.read(await read(`icons/${file}`));
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    if (!/maskable|apple/.test(file)) continue;
    let foreground = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4;
        assert.equal(image.data[offset + 3], 255, `${file} must be opaque`);
        if (image.data[offset] > 40) {
          foreground++;
          if (file.includes('maskable'))
            assert.ok(
              Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size * 0.4,
              'The complete maskable mark must fit inside its safe circle',
            );
        }
      }
    }
    assert.ok(foreground > 0, `${file} must contain the brand mark`);
  }

  const notices = (await read('third-party-licenses.txt')).toString();
  assert.equal(notices, await runtimeNotices(true));
  const worker = inspectWorker((await read('sw.js')).toString());
  assert.equal(worker.claims, 0, 'No automatic skipWaiting or clientsClaim');
  assert.equal(worker.fallback, `${base}index.html`);
  assert.equal(worker.routes.length, 1, 'No runtime data/image/API caching routes');
  const allowlist = worker.routes[0].allowlist;
  for (const path of [base, `${base}index.html`, `${base}?test=1`])
    assert.ok(
      allowlist.some((pattern) => pattern.test(path)),
      path,
    );
  for (const path of [`${base}api/x`, `${base}s/x`, `${base}uploads/x`, '/other/'])
    assert.ok(!allowlist.some((pattern) => pattern.test(path)), path);

  const files = await readdir(output, { recursive: true });
  const appAssets = files.filter((file) => /^assets\/.*\.(js|css)$/.test(file));
  assert.ok(appAssets.some((file) => file.endsWith('.js')));
  assert.ok(appAssets.some((file) => file.endsWith('.css')));
  const expected = [
    'index.html',
    'manifest.webmanifest',
    'favicon.svg',
    'third-party-licenses.txt',
    ...icons.map(([file]) => `icons/${file}`),
    ...appAssets,
  ];
  assert.deepEqual(worker.entries.map(({ url }) => url).sort(), expected.sort());
  const metadata = JSON.parse(
    html.match(
      /<script id="upscale-compare-offline-shell" type="application\/json">(.*?)<\/script>/s,
    )?.[1] || '{}',
  );
  assert.deepEqual(metadata.assets, expected.map((file) => `${base}${file}`).sort());
  assert.match(metadata.release, /\d+\.\d+\.\d+\+[a-z0-9]+/);
  assert.equal(metadata.cachePrefix, 'upscale-compare');
  for (const { url, revision, integrity } of worker.entries) {
    const content = await read(url);
    assert.equal(
      revision,
      url.startsWith('assets/') ? null : createHash('md5').update(content).digest('hex'),
      `Precache revision for ${url}`,
    );
    assert.equal(integrity, `sha256-${createHash('sha256').update(content).digest('base64')}`);
  }
  const shippedPackages = new Set();
  for (const dependency of worker.dependencies) {
    const map = JSON.parse(await read(`${dependency}.js.map`));
    await read(`${dependency}.js`);
    for (const source of map.sources) {
      const match = source.match(/node_modules\/(workbox-[^/]+)\//);
      if (match) shippedPackages.add(match[1]);
    }
  }
  assert.deepEqual(
    [...shippedPackages].sort(),
    [...workboxRuntimePackages].sort(),
    'Every distributed Workbox package must have a runtime license notice',
  );
  assert.ok(html.includes('src=') && !/registerSW|registerSW\.js/.test(html));
  const javascript = (
    await Promise.all(appAssets.filter((file) => file.endsWith('.js')).map(read))
  ).join('\n');
  assert.match(javascript, /serviceWorker/);
  assert.match(javascript, /updateViaCache:"none"/);
  assert.match(javascript, /\d+\.\d+\.\d+\+[a-z0-9]+/);
  assert.doesNotMatch(javascript, /workbox-window|registerSW/);
}

async function verifyAndroid(output) {
  const files = await readdir(output, { recursive: true });
  assert.deepEqual(
    files.filter((file) =>
      /manifest\.webmanifest|(?:^|\/)sw\.js|workbox|registerSW|icons\//.test(file),
    ),
    [],
  );
  const html = await readFile(join(output, 'index.html'), 'utf8');
  assert.doesNotMatch(
    html,
    /rel="manifest"|apple-touch-icon|registerSW|upscale-compare-offline-shell/,
  );
  assert.ok(html.includes('href="/favicon.svg"'));
  assert.equal(
    await readFile(join(output, 'third-party-licenses.txt'), 'utf8'),
    await runtimeNotices(),
  );
  for (const file of files.filter((file) => file.endsWith('.js')))
    assert.doesNotMatch(
      await readFile(join(output, file), 'utf8'),
      /serviceWorker|workbox-window|registerSW/,
    );
}

for (const mode of ['demo', 'production', 'android']) {
  for (const base of ['/', '/upscale-compare/']) {
    await test(`${mode} artifacts with VITE_BASE_PATH=${base}`, async () => {
      process.env.VITE_BASE_PATH = base;
      const output = join(directory, `${mode}-${base === '/' ? 'root' : 'pages'}`);
      await build({ mode, logLevel: 'error', build: { outDir: output } });
      if (mode === 'android') await verifyAndroid(output);
      else await verifyWeb(output, base);
    });
  }
}

await test('PWA URLs follow the resolved Vite base override', async () => {
  process.env.VITE_BASE_PATH = '/upscale-compare/';
  const output = join(directory, 'base-override');
  await build({ mode: 'demo', base: '/', logLevel: 'error', build: { outDir: output } });
  await verifyWeb(output, '/');
});

for (const mode of ['demo', 'production']) {
  await test(`development ${mode} has no PWA integration`, async () => {
    process.env.VITE_BASE_PATH = '/upscale-compare/';
    const server = await createServer({ mode, server: { port: 0 }, logLevel: 'error' });
    try {
      const html = await server.transformIndexHtml(
        '/upscale-compare/',
        await readFile(resolve('index.html'), 'utf8'),
      );
      assert.doesNotMatch(html, /rel="manifest"|apple-touch-icon|registerSW|serviceWorker/);
      assert.ok(!server.config.plugins.some(({ name }) => name.startsWith('vite-plugin-pwa')));
    } finally {
      await server.close();
    }
  });
}
