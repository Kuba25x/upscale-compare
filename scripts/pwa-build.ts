import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';
import { runtimeNotices } from './generate-notices.mjs';
import { pwaStartUrl } from '../src/lib/web-app-context';

export const pwaIcons = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];
export const appleTouchIcon = 'icons/apple-touch-icon.png';

function navigationOptions(base: string) {
  const entry = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    navigateFallback: `${base}index.html`,
    navigateFallbackAllowlist: [new RegExp(`^${entry}(?:index\\.html)?(?:\\?.*)?$`)],
  };
}

export function webPwaPlugins(): Plugin[] {
  let base = '/';
  let output = '';
  let release = '';
  const integrity = async (url: string) =>
    `sha256-${createHash('sha256')
      .update(await readFile(resolve(output, url)))
      .digest('base64')}`;
  const options: Partial<VitePWAOptions> = {
    strategies: 'generateSW',
    filename: 'sw.js',
    injectRegister: false,
    registerType: 'prompt',
    devOptions: { enabled: false },
    includeManifestIcons: false,
    manifest: {
      name: 'Upscale Compare',
      short_name: 'Upscale Compare',
      lang: 'en',
      display: 'fullscreen',
      theme_color: '#101114',
      background_color: '#101114',
      prefer_related_applications: false,
      icons: pwaIcons,
    },
    workbox: {
      cacheId: 'upscale-compare',
      globPatterns: [
        '**/*.{js,css,html}',
        'icons/*.png',
        'favicon.svg',
        'third-party-licenses.txt',
      ],
      runtimeCaching: [],
      skipWaiting: false,
      clientsClaim: false,
      // PrecacheController removes obsolete entries only from this app's own cache
      // on activation. Workbox's legacy cleanup also matches other cache prefixes.
      cleanupOutdatedCaches: false,
    },
    integration: {
      configureOptions(config, options) {
        // Use Vite's resolved base, including CLI overrides, for every PWA URL.
        base = config.base;
        release = JSON.parse(config.define!.__APP_RELEASE__ as string);
        output = resolve(config.root, config.build.outDir);
        options.scope = base;
        Object.assign(options.manifest!, { id: base, start_url: pwaStartUrl(base), scope: base });
        Object.assign(options.workbox!, navigationOptions(base));
        options.workbox!.manifestTransforms = [
          async (entries) => ({
            manifest: await Promise.all(
              entries.map(async (entry) => ({
                ...entry,
                integrity: await integrity(entry.url),
              })),
            ),
            warnings: [],
          }),
        ];
      },
      async beforeBuildServiceWorker(options) {
        // Workbox appends the plugin's manifest entry after manifestTransforms.
        options.workbox.additionalManifestEntries = await Promise.all(
          (options.workbox.additionalManifestEntries || []).map(async (entry) => {
            const item = typeof entry === 'string' ? { url: entry, revision: null } : entry;
            return { ...item, integrity: await integrity(item.url) };
          }),
        );
      },
    },
  };
  return [
    {
      name: 'web-pwa-assets',
      transformIndexHtml: () => [
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: `${base}${appleTouchIcon}` },
          injectTo: 'head',
        },
      ],
      async generateBundle() {
        for (const path of [...pwaIcons.map((icon) => icon.src), appleTouchIcon])
          this.emitFile({
            type: 'asset',
            fileName: path,
            source: await readFile(
              new URL(`../assets/pwa/${path.split('/').at(-1)}`, import.meta.url),
            ),
          });
        this.emitFile({
          type: 'asset',
          fileName: 'third-party-licenses.txt',
          source: await runtimeNotices(true),
        });
      },
    },
    ...VitePWA(options),
    {
      name: 'web-offline-readiness-metadata',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const html = bundle['index.html'];
        if (!html || html.type !== 'asset') throw new Error('Missing web entry HTML');
        // Expected resources stay in the already-precached HTML, without a new
        // endpoint, cache, runtime fetch or private comparison data.
        const assets = [
          ...new Set([
            'index.html',
            'manifest.webmanifest',
            'favicon.svg',
            'third-party-licenses.txt',
            ...pwaIcons.map((icon) => icon.src),
            appleTouchIcon,
            ...Object.keys(bundle).filter((file) => /^assets\/.*\.(js|css)$/.test(file)),
          ]),
        ]
          .sort()
          .map((file) => `${base}${file}`);
        const metadata = JSON.stringify({
          release,
          cachePrefix: options.workbox!.cacheId,
          assets,
        }).replace(/</g, '\\u003c');
        html.source = String(html.source).replace(
          '</head>',
          `<script id="upscale-compare-offline-shell" type="application/json">${metadata}</script>\n</head>`,
        );
      },
    },
  ];
}
