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

PRs #1 and #2 are merged into `main`. A release-blocking desktop panning bug is fixed and pushed on the separate branch `fix/reliable-viewer-panning`, based on `origin/main` (`c5d73b6`), with [PR #3](https://github.com/Kuba25x/upscale-compare/pull/3) open for review. A user-supplied community patch was reviewed and its CSS selection fix incorporated with generic community attribution: the patch contains no author identity. See `docs/PANNING_FIX_REVIEW.md` for the review, patch hash, experiments, and test limitations.

The root cause was reproduced in Chromium: stage/layer selection could start native HTML selection dragging despite `draggable=false` on images, causing pointer cancellation and partial movement. The adapted fix scopes selection/drag prevention to the viewer and adds reliable pointer cleanup. Upload drag-and-drop and all existing comparison functionality are preserved. Testers also confirmed Firefox; local Firefox installation is blocked by the environment's download policy, so the same regressions are enabled on the GitHub CI runner.

No merge or deployment is authorized. Preserve existing demo/production modes and Cloudflare security behavior.

## Completed features

- Community stage-selection CSS fix, default pointer selection prevention, scoped native drag cancellation, and WebKit image drag suppression.
- Capture cleanup after completion/cancellation/loss, released mouse buttons, window blur and document hiding; explicit stage focus preserves keyboard use after editing labels.
- Shared repeated-panning, cross-mode/zoom, pointer recovery and external-file upload regressions for normal and production-demo builds; Firefox projects enabled in CI.

- Frontend-only `build:demo`, `dev:demo`, and production-bundle `test:demo` commands; no backend process or cloud configuration is needed.
- Disabled Share Comparison with visible accessible demo notices; direct shared links are refused without network requests; demo privacy information is accurate.
- Manual demo/production Pages workflow options; demo tests run before publishing the static artifact. No deployment is triggered by pushes or PRs.
- Four new configuration/API-guard unit tests and ten production demo browser cases, including no unintended API or third-party requests.

- Minimal dark landing and viewer layouts following both supplied wireframes, with a viewport-centered title, adjacent share/upload buttons, and bottom A/B controls.
- Local upload/drop of 2–4 PNG/JPEG/WebP files, replacement/addition, custom labels, dimensions/file information, original byte preservation and mismatch warnings.
- Aligned split reveal, accessible divider, equal Side-by-Side panels, shared source coordinates, source-pixel zoom, cursor anchor, pan, touch pinch, keyboard shortcuts and fullscreen.
- Optional metadata dialog and read-only public comparison details.
- Explicit consent-based publication, original private R2 storage, D1 manifests, public short URLs and GitHub Pages hash navigation/refresh, escaped social preview metadata, private deletion key backup and operator moderation.
- Server file/container/raster validation, request/metadata/dimension/size limits, production Turnstile, exact allowed origins, D1-backed rate limits, global storage reservations, concurrent-safe deletion and a scheduled janitor.
- README, contributor/security/privacy/API/architecture/deployment/testing documentation and environment examples.
- CI and manual guarded Pages/Worker deployment workflows. Generated production config disables uploads and creates no resources.

## Tests executed

Current panning fix and community review, 2026-10-26:

- Community patch passes `git apply --check` against `main` at `c5d73b6` in an isolated checkout.
- The original community test fails before its CSS change and passes after that change. Its start point can hit the divider, and it does not verify image displacement; the replacement tests cover actual panning in both modes.
- A stronger real multi-click/drag reproduction fails on unmodified code (9 pixels moved for a requested 36) and passes with the adapted fix. Event traces confirm native selection dragging and pointer cancellation before the fix, and none afterward.
- `npm run build`: passed, including normal frontend/Worker TypeScript checks and production bundles.
- `npm test`: 51 passed.
- `npm run test:e2e`: 21 Chromium desktop/HiDPI/mobile cases passed.
- `npm run test:demo`: production build and 14 desktop/mobile cases passed at `/upscale-compare/`.
- Total locally executed suite: 86 passed, including all prior functionality, touch pinch/divider, pixel zoom, sharing, labels/metadata, and new panning/file-drop regressions.
- Local Firefox download failed with a network-policy HTTP 403; no Firefox execution is claimed locally. [Hosted Validate run #8](https://github.com/Kuba25x/upscale-compare/actions/runs/40410027435) passed on code commit `7ccd7a4`, including Firefox with `RUN_FIREFOX=true`: 25 full-stack + 18 demo + 51 unit/API cases, 94 passed total.
- No dependencies, backend files, license, deployment triggers, or external resources were changed by the fix. No merge or deployment was performed.

## Known limitations

- Demo publishing and remote comparison viewing are intentionally disabled. The real Pages URL has not been deployed or live-tested; production-bundle subpath tests run locally.

- No production deployment, Cloudflare account permission check, real Turnstile smoke test, or provider CPU budget benchmark has been performed.
- JPEG/WebP content is structurally validated, not fully decoded server-side. PNG additionally validates its bounded complete decompressed raster. Animated, interlaced PNG, or rotated/mirrored EXIF uploads are not accepted for publication.
- Browser color management applies; HDR/raw-color analysis is outside scope. Safari/Firefox and physical devices have not been tested.
- A crash before a pending row is inserted can conservatively over-count quota; the documented disabled-upload reconciliation procedure handles this.
- Per-IP limits do not stop distributed attacks or cap provider request costs. Large PNG validation may exceed Workers Free CPU allowance. Production requires operator contacts, monitoring, provider quota review and approval.
- No automatic expiration: active links persist until owner/operator deletion. Local unpublished state is intentionally lost on refresh.

## Exact next steps

1. Review [PR #3](https://github.com/Kuba25x/upscale-compare/pull/3). The final rapid-drag check, formatting, local suites, community-patch comparison, and attribution are complete and committed.
2. Hosted CI, including the added Firefox projects, passed all 94 cases. Preserve the community attribution in the commit/PR and review document. The fix is ready for owner code review.
3. Leave the PR unmerged and do not deploy automatically. The owner will decide when to merge and manually deploy the release-blocking fix.
4. Continue from this branch rather than restarting. Existing demo and full-stack architecture, tests, AGPL-3.0 license, and Cloudflare safeguards must remain intact.
