# PWA build artifacts

Roadmap stage D prepares web assets only. Demo and production builds emit a manifest,
PNG icons and a generated Workbox service worker. The application does **not** register
the worker, claim clients, enable offline operation or offer an update/install flow.
Those runtime changes belong to later roadmap stages. No deployment is part of this change.

## Build boundaries

`vite-plugin-pwa` is pinned to `2.0.0` and uses `generateSW`. The plugin and the web
asset emitter are included only when Vite's command is `build` and its mode is
`demo` or `production`. Development servers and Android builds omit the entire
integration. Android receives no manifest, worker, PWA icons or registration script.

Manifest `id`, `start_url` and `scope`, the Apple icon link and the generated
navigation fallback all use Vite's **resolved** `base`, including CLI overrides.
The supported deployment bases are `/` and `/upscale-compare/`. Manifest icons
resolve relative to the manifest URL. The manifest declares `standalone`, English,
the existing dark theme, no orientation lock and no native-app preference.

The generated worker's precache contains only the built HTML, JavaScript, CSS,
manifest, favicon, PNG icons and runtime license notices. Source maps, API responses,
share links, uploads and local originals are excluded. There are no runtime caching
routes; the prepared navigation fallback accepts only the base entry point and
`index.html`. No browser uses this configuration until worker registration is
explicitly implemented in a later stage.

## Icons and licenses

Committed PNGs in `assets/pwa/` are rasterizations of `public/favicon.svg`. They live
outside Vite's shared public directory so Android never copies them. The maskable
512px icon has an opaque background and keeps the complete mark inside the central
80%-diameter safe circle; the opaque Apple touch icon is 180px. The regular icons
are 192px and 512px. The original SVG favicon is preserved.

To regenerate the assets using the existing Playwright dependency:

```bash
npm run icons:pwa
```

Use `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`. Regeneration is a
maintenance command; builds consume the committed PNGs without launching a browser.

`npm run notices` continues to generate the shared runtime notices. Web builds emit
an extended copy into their output with the complete MIT licenses for the Workbox
core, precaching, routing and strategies modules actually distributed in the worker.
This happens before precache revisions are calculated. The tracked shared notices
and Android licenses remain free of web-only Workbox entries. The existing Source
code / AGPL-3.0 link and license access in Help are retained.

## Verification

```bash
npm run test:pwa:build
npm run test:demo
npm run test:android:web
```

The artifact check uses temporary output directories and covers all six combinations
of `demo`/`production`/`android` and root/Pages environment bases, a resolved-base
override, and both web development modes. It checks manifest fields and links, PNG
dimensions and maskable safe area, actual worker precache entries and revisions,
navigation boundaries, shipped Workbox license coverage and Android isolation.
It inspects the worker without registering it. The normal browser suites also
verify asset URLs under the Pages subpath, local image import, existing source and
license links, and zero worker registrations or Cache Storage entries.

At the stage-D checkpoint, `npm audit --audit-level=high` passes with no high or
critical findings. The pinned plugin's build-tool dependency tree has six audit
entries (four moderate, two low), originating in `glob`/`minimatch` and `deepmerge`
and propagated to their parents. They concern build-time pattern traversal and
object merging; these packages are not distributed in the browser bundle or worker.
No major transitive overrides or plugin downgrade are applied to bypass the report.
