# Private offline app shell

Roadmap stages D and E prepare the web assets and enable a private offline shell in
demo and production builds. After page load, a web-only module registers the generated
worker in a secure context when the Service Worker API is available. Registration
failure leaves normal online comparison available. Development and Android builds
exclude this module entirely. Installation guidance and public release qualification
belong to stage F; no deployment or installation prompt is part of this change.

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
`index.html`. Hash routes continue to use the existing application router. There is
no runtime cache or Background Sync. Local screenshot bytes, names, labels and
metadata remain in memory; a new app session starts empty. Existing explicit
publication/deletion credentials retain their established storage behavior and
are never copied into Cache Storage.

## Registration and updates

The stable worker URL is `sw.js` under the resolved Vite base. Registration uses
that base as its scope and `updateViaCache: 'none'`. The web registration chunk
embeds an application-version / short-commit identifier for diagnostics (for example
`0.1.0+1234abcd`), from `package.json` and `GITHUB_SHA` or Git. Source archives without
Git metadata use the `+source` suffix. No release UI is added in this stage.

Vite hashes JavaScript/CSS filenames and Workbox revisions the other shell files.
All precache entries also carry SHA-256 integrity metadata, so a 200 response with
damaged content fails installation rather than becoming an accepted cached module.

`skipWaiting` and `clientsClaim` remain false. There is no update polling, automatic
reload, update message or `controllerchange` handler. The browser installs a new
version in the background and keeps it waiting while any tab/window uses the active
version. Existing views keep their in-memory comparisons. After all old clients
close, the next version can activate; the next app session starts empty.

Versions share one application/scope-specific precache. Installation adds the new
revision's files without removing old entries, so a failed or incomplete update
leaves the old shell usable. PrecacheController removes obsolete entries from that
cache only during activation. Workbox's broader legacy `cleanupOutdatedCaches`
operation is disabled; unrelated caches and publication/deletion keys are untouched.
Offline availability starts only after successful installation and remains subject
to browser storage eviction. No additional persistence of local comparisons is added.

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
npm run test:pwa
npm run test:pwa:sharing
npm run test:demo
npm run test:android:web
```

The artifact check uses temporary output directories and covers all six combinations
of `demo`/`production`/`android` and root/Pages environment bases, a resolved-base
override, and both web development modes. It checks manifest fields and links, PNG
dimensions and maskable safe area, actual worker precache entries and revisions,
navigation boundaries, shipped Workbox license coverage and Android isolation.
It inspects the worker without registering it. Dedicated PWA browser suites register
real workers against disposable A/B releases, exercise offline local import and
original-byte equality, one/multiple-client updates, failed/missing/corrupt resources,
scope boundaries, cache privacy and unrelated data retention. Chromium also stops
the worker before offline reopening. Production-mode verification doubles exercise
sharing, original restoration and verification failure with an active worker.
The normal demo suite verifies that a registration failure does not block local use.
Firefox/WebKit projects are enabled with `RUN_FIREFOX=true` and `RUN_WEBKIT=true`.

At the stage-D checkpoint, `npm audit --audit-level=high` passes with no high or
critical findings. The pinned plugin's build-tool dependency tree has six audit
entries (four moderate, two low), originating in `glob`/`minimatch` and `deepmerge`
and propagated to their parents. They concern build-time pattern traversal and
object merging; these packages are not distributed in the browser bundle or worker.
No major transitive overrides or plugin downgrade are applied to bypass the report.
