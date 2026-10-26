# Development progress

## Project constraints

All application content, code, documentation, commits, and PRs must be in English. User conversation is in Polish. Preserve the existing AGPL-3.0 license. Do not deploy to production, create paid resources, or incur costs without explicit approval.

## Design and architecture

The supplied wireframes are the layout authority: a narrow header with a geometrically centered title; an almost empty landing page with a centered upload button; a full-viewport viewer with mode controls on the left, adjacent Share Comparison and Upload Images buttons on the right, and a narrow bottom A/B selection and label bar. Dark theme, subtle lime accent. No sidebar or marketing sections.

React + TypeScript + Vite frontend for GitHub Pages. Separate Cloudflare Worker API, private R2 originals, D1 records, quota and rate-limit ledger. Local Wrangler/Miniflare development requires no Cloudflare account. Screenshots remain local until explicit publishing. Public pages are read-only; deletion uses a private capability token.

## Implementation plan

1. Implement local upload, the two layouts, shared image coordinates, split divider, synchronized navigation, source-pixel zoom, keyboard/touch controls, and unobtrusive metadata.
2. Implement validated publishing, persistence, public URLs, deletion and moderation, quota/rate limits, and local emulation.
3. Execute unit, Worker integration and Chromium end-to-end tests; verify rendered pixel alignment and mobile layouts; fix issues.
4. Complete contributor, security, privacy and deployment documentation and guarded manual deployment workflows.
5. Commit verified milestones and prepare a reviewable PR if GitHub access permits.

## Current status

The application is implemented and pushed on branch `feat/upscale-compare`, with [pull request #1](https://github.com/Kuba25x/upscale-compare/pull/1) open for review against `main`. Both implementation checkpoints survived the usage-limit interruption. [GitHub Actions Validate run #1](https://github.com/Kuba25x/upscale-compare/actions/runs/40389516336) passed on commit `fd6655f46c642209f493e2a3f65d8d327541eb71`. No production resources have been created or deployed. Cloudflare credentials remain absent. Ordinary configured Git supports pushes and the GitHub connector supports PR operations; the standalone GitHub CLI did not authenticate in this environment.

## Completed features

- Minimal dark landing and viewer layouts following both supplied wireframes, with a viewport-centered title, adjacent share/upload buttons, and bottom A/B controls.
- Local upload/drop of 2–4 PNG/JPEG/WebP files, replacement/addition, custom labels, dimensions/file information, original byte preservation and mismatch warnings.
- Aligned split reveal, accessible divider, equal Side-by-Side panels, shared source coordinates, source-pixel zoom, cursor anchor, pan, touch pinch, keyboard shortcuts and fullscreen.
- Optional metadata dialog and read-only public comparison details.
- Explicit consent-based publication, original private R2 storage, D1 manifests, public short URLs and GitHub Pages hash navigation/refresh, escaped social preview metadata, private deletion key backup and operator moderation.
- Server file/container/raster validation, request/metadata/dimension/size limits, production Turnstile, exact allowed origins, D1-backed rate limits, global storage reservations, concurrent-safe deletion and a scheduled janitor.
- README, contributor/security/privacy/API/architecture/deployment/testing documentation and environment examples.
- CI and manual guarded Pages/Worker deployment workflows. Generated production config disables uploads and creates no resources.

## Tests executed

- `npm run build`: passed, including separate frontend/Worker TypeScript checks.
- `npm test`: 47 passed (31 unit + 16 Miniflare API integration tests).
- `npm run test:e2e`: all 17 passed in the final full run, including desktop, DPR 1.25/DPR 2, mobile touch, shared navigation/refresh and owner deletion. Total automated tests: 64 passed.
- Actual screenshot pixel samples match original RGBA at 100% in both modes on DPR 1, 1.25 and 2. Global physical-pixel snapping and shared full-stage clipping avoid fractional CSS layout rounding in Chromium.
- Desktop/mobile screenshots visually inspected. Title text and landing-button centering refinements are covered by the passing browser run.
- Full production + tooling dependency audit: zero known vulnerabilities. Vitest is 5.0.5, and direct Miniflare is pinned to Wrangler's patched 5.20261023.0-beta using its supported configuration adapter. Runtime MIT/ISC licenses were verified and included in a generated public notice.
- Found and fixed cursor-anchor rounding, dialog persistence on hash navigation and fractional Side-by-Side rasterization. DOM floating-point expectations use numerical precision tolerances; rendered source-pixel RGBA assertions remain exact.
- `npm run format:check` and `git diff --check`: passed.
- Production repository-subpath build, browser smoke, config generation and Worker dry-run packaging: passed; no deployment occurred. The final resumed browser smoke also verified the generated runtime license artifact and reported no browser errors.
- Hosted GitHub Actions Validate run #1: success (production build, unit/API tests, Chromium E2E, full dependency audit and repository-subpath build).

## Known limitations

- No production deployment, Cloudflare account permission check, real Turnstile smoke test, or provider CPU budget benchmark has been performed.
- JPEG/WebP content is structurally validated, not fully decoded server-side. PNG additionally validates its bounded complete decompressed raster. Animated, interlaced PNG, or rotated/mirrored EXIF uploads are not accepted for publication.
- Browser color management applies; HDR/raw-color analysis is outside scope. Safari/Firefox and physical devices have not been tested.
- A crash before a pending row is inserted can conservatively over-count quota; the documented disabled-upload reconciliation procedure handles this.
- Per-IP limits do not stop distributed attacks or cap provider request costs. Large PNG validation may exceed Workers Free CPU allowance. Production requires operator contacts, monitoring, provider quota review and approval.
- No automatic expiration: active links persist until owner/operator deletion. Local unpublished state is intentionally lost on refresh.

## Exact next steps

1. Review [PR #1](https://github.com/Kuba25x/upscale-compare/pull/1). The application is ready for code review; do not restart implementation. Keep `main` unchanged until review/merge is authorized.
2. Leave production disabled. After owner approval, configure a private Cloudflare R2 bucket, D1 database, least-privilege token, Turnstile widget/secrets, operator privacy/abuse contacts and GitHub deployment environment variables. Follow `docs/DEPLOYMENT.md`.
3. Run the documented real-provider smoke tests and CPU/quota review before enabling public uploads. Deploy only after explicit authorization; do not enable paid resources without approval.
4. If code changes during review, run the affected tests and update this checkpoint. Local preview can be started with the README commands; no Internet-public preview or production URL exists yet.
