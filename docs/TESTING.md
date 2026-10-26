# Testing and verification

## Automated checks

```bash
npm run build
npm test
npm run test:e2e
npm run test:demo
npm run format:check
npm audit --audit-level=high
```

Node.js 24 and system Chromium are used in the managed development environment. Playwright can also use its downloaded Chromium through `CHROMIUM_PATH`. The browser suite starts local Vite and Wrangler with a separate persisted state directory per run. Miniflare API tests use isolated in-memory D1 and R2. No Cloudflare account, production resources, or public upload endpoint is involved.

## Coverage

- Geometry and schema: fit without cropping, DPR 1/1.25/2/3 source-pixel scaling, physical origin rounding, cursor anchor, shared pan deltas, bounded zoom and strict manifests.
- Image-content validation: full valid PNG, CRC corruption, truncation, trailing data, dimensions, pixel/file limits, decompression mismatch, spoofed HTML/SVG/GIF, actual generated JPEG/WebP fixtures and rotated EXIF rejection.
- Worker with real local D1/R2: publication, original byte identity, manifest restoration, safe headers/filenames, escaped social metadata, subpath redirect, deletion authorization, operator moderation, deletion/quota release, CORS/origin checks, spoofed MIME, malformed JSON/manifests, image counts, multipart/request limits, full storage, throttling, unknown IDs, production fail-closed behavior, concurrent quota reservation and concurrent deletion.
- Desktop browser: centered title and adjacent share/upload controls, no automatic upload, invalid/local upload, drag/drop, divider drag/keyboard, source-coordinate alignment, cursor zoom, synchronized panning/mode switching, four-image selection, renaming, metadata, replacement/mismatched dimensions, keyboard/fullscreen, publication consent, public direct navigation/refresh, API errors and owner deletion.
- Pixel assertions read actual browser screenshots and compare sampled rendered RGBA values to generated source pixels at 100%, on DPR 1, 1.25 and 2 in both Split Screen and Side-by-Side. These test display geometry and nearest-pixel behavior, not just DOM attributes.
- Mobile browser: 390 × 844 viewport with DPR 2, all main controls accessible, no horizontal document scrolling, touch divider, and actual emulated two-finger pinch events through Chromium's DevTools protocol.

Generated test patterns contain no private or third-party game assets. Browser screenshots/reports are ignored by Git and saved as CI artifacts.

## Executed results

Last verified development checkpoint: 2026-10-26.

- Frontend and Worker TypeScript checks: passed.
- Vite production build and Worker bundle: passed.
- Unit + Miniflare integration suite: **51 passed** (including four demo configuration/API guard tests).
- Chromium desktop/HiDPI/mobile suite: **17 passed**, including exact RGBA checks in both modes at DPR 1, 1.25 and 2, owner deletion and the deleted-link page.
- Production demo browser suite: **10 passed** on desktop/mobile, with all unexpected API/external requests monitored and none observed. Total automated tests: **78 passed**.
- Full runtime and development dependency audit: **0 known vulnerabilities**.
- Desktop and mobile rendered screenshots: inspected against the supplied wireframes.
- Production repository-subpath browser smoke: passed (assets, centered landing, JPEG/WebP upload, 1:1 size and mode switching; no browser errors).
- Production configuration generation and Worker `deploy --dry-run` packaging: passed with dummy resource IDs and uploads disabled; no resources were created or deployed.
- [Hosted GitHub Actions Validate run #1](https://github.com/Kuba25x/upscale-compare/actions/runs/40389516336): **success** for commit `fd6655f46c642209f493e2a3f65d8d327541eb71`, including production builds, all unit/API/browser tests and the full dependency audit.

## Limits of verification

Chromium emulation is not a physical iPhone/Android device or a Safari/Firefox run. The suite does not establish HDR/colorimetric accuracy, large-file performance on every machine, real production CPU/billing limits, real Turnstile account verification, production DNS/TLS, or actual R2/D1 account permissions. Cloudflare deployment and social-platform preview caches require approved production smoke tests.

Static GitHub Pages subpath output is checked separately during CI. Publishing uses original byte comparisons; no lossy round-trip is introduced by the app. Full JPEG/WebP decoding is delegated to the browser, while the server performs structural validation. See SECURITY.md and deployment docs for operational boundaries.

The test suite pins Miniflare to the same patched version bundled with Wrangler (`5.20261023.0-beta`) and uses its supported v4-options adapter. This avoids outdated image/network dependencies in the older stable Miniflare package; the lockfile records the exact tooling.

## Frontend-only demo verification

`npm run test:demo` builds with Vite mode `demo` and runs `playwright.demo.config.ts` against the static production preview at `/upscale-compare/`. It starts no Worker, D1, or R2 process. Each browser case intercepts requests, permits only the demo's own asset subpath (plus local object URLs), and fails if it attempts an API, short-link backend, or third-party verification request. Shared-link navigation and refresh are explicitly exercised.

The suite also verifies accessible sharing explanations, metadata/labels, four-image selection, addition/replacement, synchronized zoom/pan, divider interaction, physical source pixels, shortcuts/fullscreen, mobile overflow, and static favicon/license assets. Unit tests prove that both demo-mode activation mechanisms reject API helpers even if a backend URL is supplied, while normal production and local-development behavior are retained.

The generated demo bundle was additionally inspected: Vite asset paths include `/upscale-compare/`; runtime JavaScript includes no `http://localhost:8787` address or Turnstile script URL. The real GitHub Pages deployment is intentionally not dispatched during implementation.
