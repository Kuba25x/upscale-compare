# Development and controls

This guide retains developer setup and operating details from the original README.
The public web app and Android preview disable Share Comparison. Full-stack sharing
is available for isolated local development; production remains locked.

## Frontend-only development

The GitHub Pages demo works without Cloudflare or any backend configuration. All local comparison tools remain available. **Share Comparison is disabled**, and published comparison links show an explanation instead of contacting a server. Images, labels, and metadata remain in browser memory and are lost on refresh. No Turnstile widget is loaded.

```bash
npm ci
npm run build:demo
npm run preview -- --mode demo
```

Open [http://localhost:4173/upscale-compare/](http://localhost:4173/upscale-compare/). For development, use `npm run dev:demo`. Public `.env.demo` configuration sets the `/upscale-compare/` asset base automatically; it contains no secrets. `npm run test:demo` builds and tests this production bundle with no Worker, D1, or R2 process.

For the approved GitHub Pages destination, follow [manual demo deployment](DEPLOYMENT.md#frontend-only-github-pages-demo). Choose **demo** and explicitly confirm **DEPLOY** in the workflow. No API URL, Turnstile key, or Cloudflare credentials are needed. The source is prepared for [https://kuba25x.github.io/upscale-compare/](https://kuba25x.github.io/upscale-compare/); this documentation does not indicate that deployment has been performed.

The full-stack build and backend remain available for local validation. Production deployment is separately guarded and remains locked; configuring the sharing service does not unlock it.

## Quick start

Requires Node.js 22.12 or later (Node.js 24 is used in CI) and npm. No Cloudflare account is required for local development.

```bash
npm ci
cp .env.example .env
npm run db:local
npm run costs:local # Generous local-only test limits; never a production policy
npm run dev:api
```

In a second terminal:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Upload two screenshots. Local sharing uses Wrangler's persistent D1 and R2 emulation on port 8787. Local share URLs work only while that service is running and are not Internet-public. Do not expose the development Worker to the Internet.

In a restricted environment where your home configuration directory is not writable, prefix Wrangler commands with `XDG_CONFIG_HOME=/tmp/upscale-compare-config`. Disable optional Wrangler telemetry with `WRANGLER_SEND_METRICS=false`.

## Controls

| Action                      | Control                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| Pan both images             | Drag / arrow keys                                                 |
| Zoom at the cursor          | Mouse wheel                                                       |
| Touch navigation            | One-finger drag / two-finger pinch                                |
| Fit complete images         | `0`                                                               |
| 100%, 200%, 400%            | `1`, `2`, `4`                                                     |
| Zoom in / out               | `+`, `-`                                                          |
| Split Screen / Side-by-Side | `S`, `V`                                                          |
| Swap A and B                | `X`                                                               |
| Previous / next image for A | `[`, `]`                                                          |
| Fullscreen                  | `F`                                                               |
| Help                        | `?`                                                               |
| Move divider                | Drag handle; focus it and use arrow keys, Shift+arrows, Home, End |

At explicit integer magnifications the image origin is snapped to physical pixels and nearest-neighbor rendering is used. Fit can resample the display to show the complete image; it never changes the underlying file. Browser zoom and display changes are reflected through `devicePixelRatio`. Color management is controlled by the browser; this is not an HDR or raw-color analysis tool.

On mobile touch devices, Fullscreen shows only the comparison, its split divider and
an exit button. The comparison view also works when the browser keeps its own bars
visible. Use Exit fullscreen or Escape to restore the controls; leaving browser
fullscreen also restores them. Rotation preserves the selected images, labels,
metadata and zoom. Desktop fullscreen retains the normal interface.

## Development and validation

```bash
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run test:demo
```

Playwright uses `/usr/bin/chromium` by default. On other systems:

```bash
npx playwright install chromium
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
npm run test:demo
```

Use `node -e "console.log(require('playwright').chromium.executablePath())"` to locate the downloaded browser. End-to-end tests launch Vite and local Wrangler automatically. Unit and API tests use isolated Miniflare D1/R2 instances. See [testing](TESTING.md) for coverage and executed results.

## Architecture

```text
Browser (React + TypeScript + Vite)
  ├─ Local object URLs → image inspection; no image network traffic
  └─ Explicit publish → Cloudflare Worker
                         ├─ D1: immutable manifests, deletion hashes, rate limits, quota
                         └─ Private R2: unmodified originals
GitHub Pages → frontend (/upscale-compare/ supported)
Worker /s/<id> → Open Graph metadata → frontend #c/<id>
```

Hash routes make direct links and browser refreshes work on GitHub Pages without server rewrites. The Worker share URL provides server-generated social metadata. Frontend and backend deployments are independent. See [architecture](ARCHITECTURE.md), [API](API.md), and [deployment](DEPLOYMENT.md).

## Limits and security

Defaults: 2–4 images, 20 MiB per file, 40 MiB total per publication, 36 megapixels per image, and 16,384 pixels per side. The server also enforces configurable request, storage, comparison-count, and IP rate limits. Public PNG publishing accepts non-interlaced still images. Rotated/mirrored EXIF images must be exported with normalized orientation before publishing. JPEG/WebP validation checks container structure and dimensions; PNG validation additionally checks chunk CRCs and the complete bounded decompressed raster. See [security](../SECURITY.md) for scope and limitations.

Production sharing requires an allowed HTTPS frontend origin, private R2, initialized D1, a Turnstile challenge, and operator-configured moderation. The owner requires **zero charges on Workers/D1 Free and included R2 Standard usage**. Production workflows are main-only and currently **locked**, pending measured resource suitability and enforceable R2 zero-overage protection. `npm run ops:check` intentionally exits 1; no confirmation or variable overrides this lock. The Pages demo remains available through its manual deployment workflow. See [guarded operations and owner decisions](OPERATIONS.md) and [the Free-only envelope](FREE_TIER_OPERATIONS.md).

The [Free-only feasibility investigation](FREE_SHARING_FEASIBILITY.md) adds local CPU/codec evidence and compares storage/execution alternatives. It does not approve an architecture, unlock deployment or begin stage 8.

The [local SQLite DO/KV and complete-codec research](FREE_STORAGE_RESEARCH.md) adds isolated prototypes and failure/resource evidence. SQLite DO storage is the recommended research direction; full 8K validation and provider limits remain blockers. Production R2 and the deployment lock are unchanged.

The [phase A/B execution comparison](FREE_VALIDATION_EXECUTION_RESEARCH.md) adds public-limit clarification, unsent Cloudflare questions and 216 local workerd/Chromium validation jobs. Local Chromium is not Browser Run; actual browser resources, large-file transport and the 600-second daily allowance remain unqualified. No production migration or later phase is authorized by these results.

Upload parsing and image validation also enforce fixed structural and memory
ceilings. See [resource limits](RESOURCE_LIMITS.md) for details, overload
behavior and the remaining production verification requirements.

Publication now reserves quota together with its pending record and retains
cleanup markers after interrupted storage operations. See [publication recovery](PUBLICATION_RECOVERY.md)
for retry behavior, deletion grace and migration requirements.

Publication attempts also save their private key before uploading and support
24-hour result recovery without resending images. Interrupted attempts appear
under **Recover publication**, including after a refresh. See [recoverable retries](PUBLICATION_RETRIES.md)
for identifier binding, migration 0003 and remaining limitations.

Migration 0004 adds shared daily admissions, publication and image-read budgets,
plus a persistent emergency publishing stop without redeployment. New production
policy defaults to paused with zero daily limits. See [cost controls and the stop runbook](COST_CONTROLS.md)
for accounting, budget recommendations, closed hostnames and remaining billing risks.

`npm run test:sharing:local` validates the built production sharing flow with a
production-mode local Worker, D1/R2 and offline verification doubles, including
the repository subpath, retries and owner deletion. See [local sharing validation](LOCAL_SHARING_VALIDATION.md)
for setup, coverage and the limits of this evidence. It does not contact real
Turnstile or enable any production service.

Original bytes and comparison restoration are covered by a generated PNG/JPEG/WebP
matrix, SHA-256 round trips and production browser checks at multiple display
densities. See [original fidelity and restoration](ORIGINAL_FIDELITY.md) for
the exact guarantees, remaining color/device limits and real-screenshot acceptance
checklist.

## Privacy and deletion in the local full-stack build

Unpublished web images exist only in browser memory and are lost on refresh. Published screenshots are public to anyone with the link, including embedded metadata in the original files. Private publication/deletion keys are saved in browser storage before uploading; download a backup and keep it private. Open the shared comparison and choose **Share Comparison → Manage published comparison** to delete it. Keys are not included in public URLs. Deletion cannot recall copies already downloaded elsewhere. See [privacy](PRIVACY.md).
