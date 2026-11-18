# Deployment and operation

Production is deliberately not deployed by default. Do not create resources, enable billable services, expose the development Worker, or enable public uploads without the project owner's approval.

## Frontend-only GitHub Pages demo

This option publishes the local comparison application without any Cloudflare integration. It does not need Workers, R2, D1, an API URL, a Turnstile site key, or cloud secrets. Public sharing is visibly disabled; API helpers also reject calls in demo mode, including direct shared-link navigation. All local upload, metadata, inspection, labeling, and image-selection features remain available.

The owner has already selected **GitHub Actions** under **Settings → Pages → Build and deployment → Source**. After reviewing and merging PR F into `main`, and separately approving deployment:

1. Open the repository's **Actions** tab.
2. Select **Deploy frontend to GitHub Pages**.
3. Click **Run workflow** and select branch **main**.
4. Set **deployment_mode** to **demo** (the default).
5. Enter **DEPLOY** exactly in **confirmation**, then click **Run workflow**.
6. If the `github-pages` environment requires approval, approve that deployment in GitHub.
7. Wait for the deployment job to finish. The expected URL is [https://kuba25x.github.io/upscale-compare/](https://kuba25x.github.io/upscale-compare/).

The workflow only publishes after that explicit manual dispatch. A push, merge, or PR does not deploy the site. An incorrect confirmation skips publishing. `npm run audit:dependencies` blocks all critical and unaccepted high findings; its only temporary build-only exception, raw reports and automatic expiry are documented in the [dependency risk review](DEPENDENCY_AUDIT.md). Before publishing demo, it also runs the PWA artifact matrix, offline/update tests and a real installed Chromium app-window test, then `npm run test:demo` builds and tests the exact `dist/` to upload. These checks use local static servers and do not start a Cloudflare Worker or initialize D1/R2. Full-stack CI verifies backend regressions separately. Review the [acceptance boundary](PWA_RELEASE_QA.md#current-acceptance-boundary) and complete the physical Android and hosted smoke checklist after an approved dispatch; local tests do not establish those results.

`.env.demo` is committed public build configuration:

```dotenv
VITE_DEMO_MODE=true
VITE_API_URL=
VITE_TURNSTILE_SITE_KEY=
VITE_BASE_PATH=/upscale-compare/
```

`npm run build:demo` selects Vite mode `demo`; that mode always disables sharing, even if an environment override mistakenly sets `VITE_DEMO_MODE=false` or provides backend credentials. The generated frontend contains no secrets. The workflow sets `VITE_BASE_PATH=/<repository-name>/`, so asset paths match GitHub Pages. A custom root domain requires an intentional base-path override.

For a local preview and tests:

```bash
npm run build:demo
npm run preview -- --mode demo
# In another terminal, or after stopping the preview:
npm run test:demo
```

The preview is served at `http://localhost:4173/upscale-compare/`. Tests use a separate preview server on port 4174, desktop and mobile viewports, and reject unexpected API/external requests. No Cloudflare account or local API server is necessary.

## Compatible PWA rollback

Rebuild a reviewed, known-good frontend with compatible PWA configuration, the same
manifest identity/base and the same `/upscale-compare/sw.js` address. Run the demo
and PWA gates and publish it through the same owner-approved manual workflow.
The rollback worker follows the existing lifecycle: current windows retain their
comparison, and the rollback waits until all old clients close. New sessions are empty.

Do not delete `sw.js`, remove registration code or expect an ordinary page refresh
to uninstall an existing worker. Do not force `skipWaiting`, claim clients, reload
active comparisons or broaden cache cleanup as a rollback shortcut. A compatible
B→A release is covered by automated lifecycle tests.

## Repair only this PWA's cache

Use this only for a stuck/cleared offline cache, with disposable or finished local
comparisons. Close other app windows/tabs; leave one Pages tab open for DevTools.
This procedure unregisters only the expected app worker and removes only its scoped
precache. It preserves other apps' caches and all publication/deletion keys and journals.

<!-- pwa-scoped-repair -->

```js
(async () => {
  const base = new URL('/upscale-compare/', location.origin);
  if (!location.pathname.startsWith(base.pathname))
    throw new Error('Open the Upscale Compare Pages app before repair.');
  const registration = await navigator.serviceWorker.getRegistration(base.href);
  const script = new URL('sw.js', base).href;
  if (
    registration &&
    (registration.scope !== base.href ||
      [registration.active, registration.waiting, registration.installing].some(
        (worker) => worker && worker.scriptURL !== script,
      ))
  )
    throw new Error('Unexpected service worker; stop and inspect its scope.');
  await registration?.unregister();
  for (const name of await caches.keys())
    if (name.startsWith('upscale-compare-precache-') && name.endsWith(base.href))
      await caches.delete(name);
})();
```

Close that last tab, reconnect and reopen the exact Pages URL online. Let resources
finish caching and check Help again before testing offline. Do not use origin-wide
**Clear site data**, `localStorage.clear()`, blanket cache deletion or journal/database
deletion as an app-cache repair. Ordinary reopening is expected to lose the local
in-memory comparison; original files on the device are never removed by this procedure.

## Production sharing: blocked under the Free-only policy

The owner requires Workers Free, D1 Free and included R2 Standard usage with zero
charges. Do not activate R2, select a paid plan or run remote actions on the basis
of these documents. Stage 7's [guarded operations runbook](OPERATIONS.md) and
[Free-tier envelope](FREE_TIER_OPERATIONS.md) supersede earlier paid-capacity
suggestions and generic provisioning instructions.

`npm run ops:check` intentionally fails. CPU/memory suitability of the current
large-original pipeline, complete usage accounting and a zero-overage R2
arrangement remain unverified. Both production manual workflows require `main`
and run this release lock before installs, checks or remote actions. A workflow
confirmation or environment variable cannot override it. The Pages demo remains
independent and uses the authorized manual procedure above.

### Offline production package preparation

This command only writes an ignored local configuration; use dummy IDs when
reviewing a package without approved resources:

```bash
D1_ID=00000000-0000-0000-0000-000000000000 \
BUCKET=private-review-bucket \
FRONTEND_URL=https://viewer.example/upscale-compare/ \
node scripts/prepare-production.mjs
```

The generated `worker/wrangler.production.json` has production verification,
exact allowed frontend origin and the existing application ceilings. Uploads,
cron, observability, workers.dev and preview URLs are disabled, with no public
route or paid CPU/plan override. D1's initial policy remains paused/zero. The
20 MiB/40 MiB/36 MP ceilings are not approved Free-safe limits. The development
`worker/wrangler.jsonc` is local-only and deliberately omits real verification;
never deploy it. No credentials are needed for local tests.

The optional **Deploy Cloudflare API** workflow no longer performs remote D1
migrations. A future authorized release must separately review schema compatibility,
backup/drain evidence and migration approval. The current release lock prevents
its deploy step from running. Secret/resource creation, setting keys, schema work,
hostname exposure, retention cron and upload opening are distinct owner actions,
not consequences of merging a PR.

Before a future rollout, record the exact account/resources/hostname, Free-plan
headroom, R2 billing protection, privacy/moderation contacts, retention/backups,
monitoring and real-resource/source-device acceptance. Follow the runbook for
maintenance, migration, disabled deployment, smoke tests, incident shutdown,
restore and compatible rollback. No production sequence is authorized by stage 7.

GitHub Pages serves hash routes at the selected repository subpath; publish only
`dist/`. It cannot generate comparison-specific social metadata, which is served
by the Worker `/s/<id>` route. An approved future production frontend needs an
HTTPS API URL and public Turnstile site key for the exact reviewed hostname.
Backend secrets must never enter Vite. GitHub Pages cannot set custom response
headers; assess a frontend CSP if a different host is selected, without assuming
another paid product.
