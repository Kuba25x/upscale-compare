# Testing and verification

## Automated checks

```bash
npm run build
npm test
npm run test:e2e
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
- Unit + Miniflare integration suite: **47 passed**.
- Chromium desktop/HiDPI/mobile suite: **17 passed**, including exact RGBA checks in both modes at DPR 1, 1.25 and 2, owner deletion and the deleted-link page.
- Full runtime and development dependency audit: **0 known vulnerabilities**.
- Desktop and mobile rendered screenshots: inspected against the supplied wireframes.
- Production repository-subpath browser smoke: passed (assets, centered landing, JPEG/WebP upload, 1:1 size and mode switching; no browser errors).
- Production configuration generation and Worker `deploy --dry-run` packaging: passed with dummy resource IDs and uploads disabled; no resources were created or deployed.

## Limits of verification

Chromium emulation is not a physical iPhone/Android device or a Safari/Firefox run. The suite does not establish HDR/colorimetric accuracy, large-file performance on every machine, real production CPU/billing limits, real Turnstile account verification, production DNS/TLS, GitHub-hosted workflow execution, or actual R2/D1 account permissions. Cloudflare deployment and social-platform preview caches require approved production smoke tests.

Static GitHub Pages subpath output is checked separately during CI. Publishing uses original byte comparisons; no lossy round-trip is introduced by the app. Full JPEG/WebP decoding is delegated to the browser, while the server performs structural validation. See SECURITY.md and deployment docs for operational boundaries.

The test suite pins Miniflare to the same patched version bundled with Wrangler (`5.20261023.0-beta`) and uses its supported v4-options adapter. This avoids outdated image/network dependencies in the older stable Miniflare package; the lockfile records the exact tooling.
