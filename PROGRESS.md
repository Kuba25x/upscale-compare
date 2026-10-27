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

PRs #1, #2, #3 and #5 are merged into `main`. Work continues from `origin/main` at `be6c936` on the separate branch `fix/divider-pointer-focus` for [Issue #6](https://github.com/Kuba25x/upscale-compare/issues/6), with [PR #7](https://github.com/Kuba25x/upscale-compare/pull/7) open against `main`, following up the clarified input behavior after Issue #4 and PR #5.

The remaining cause is explicit slider focus in `onPointerDown`: Chromium can later activate `:focus-visible` when any key is pressed. Pointer gestures now focus the existing viewer stage instead, keeping shortcuts available after label editing and removing old slider keyboard focus when switching to the mouse. Real Tab/Shift+Tab navigation still reaches the slider and reveals its existing accessible handle ring. No CSS or global modality tracking is introduced. Pointer capture, touch handling, geometry, slider keys and image navigation remain unchanged.

Shared regressions now verify actual focus ownership, the absence of both handle rings and full-height lines after pointer use, shortcuts/fullscreen/mode switches, label-input exit, repeated keyboard-to-mouse-to-Tab transitions, and the distinction between image-pan arrows and focused-slider arrows. The mobile touch/pinch case also checks focus ownership after touch input. Chromium and Firefox run the shared cases in both regular and demo builds.

The previous community panning fix remains intact, including its attribution and review in `docs/PANNING_FIX_REVIEW.md`.

Development organization: search existing GitHub Issues before creating a substantive bug/feature report; use existing labels, keep unrelated problems separate, and link resolving PRs. Do not close an issue before verification and merge, create retroactive issues for finished work, or start other issues without the owner's prioritization.

No merge or deployment is authorized. Preserve existing demo/production modes and Cloudflare security behavior.

## Completed features

- Pointer divider gestures retain viewer-stage focus; Tab/Shift+Tab give the slider keyboard focus. Regression coverage checks both directions of input switching, real shortcuts, fullscreen and prior input-field focus.

- Handle-only divider focus styling, with rendered-pixel and keyboard/fullscreen/mode-switch regressions shared by regular and demo browser suites.

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

Current pointer/keyboard focus follow-up, 2026-10-27:

- The new regression failed against unmodified main at `be6c936`: after a mouse click and letter key, the divider incorrectly remained `document.activeElement`.
- After the focus-ownership fix, all three targeted Chromium focus cases passed.
- `npm run build`: passed (frontend/Worker typechecks and production bundles).
- `npm test`: 51 passed.
- `npm run test:e2e`: 24 Chromium desktop/HiDPI/mobile cases passed, including touch/pinch, panning, file drops, pixel alignment and sharing.
- `npm run test:demo`: production demo build and 17 desktop/mobile cases passed at `/upscale-compare/`.
- 92 local suite cases passed. `npm run format:check` and `git diff --check` passed.
- Firefox runs in hosted CI because no compatible local Firefox is installed and the official download domains are blocked by the environment policy. Exact hosted Chromium/Firefox results are recorded in the Validate checks and Validation section of [PR #7](https://github.com/Kuba25x/upscale-compare/pull/7).

Previous divider outline fix, 2026-10-27:

- Baseline Chromium reproduction confirms the reported green-line geometry.
- New regression failed on unmodified main: 32 unwanted accent pixels in a strip above the handle; the same test passes after the CSS change.
- Targeted divider regression: 2 Chromium tests passed, including real fullscreen, focus visibility, mode changes, keyboard and mouse movement.
- `npm run build`: passed (frontend/Worker typechecks and production bundles).
- `npm test`: 51 passed.
- `npm run test:e2e`: 23 Chromium desktop/HiDPI/mobile cases passed, including touch divider/pinch, pixel zoom, sharing, panning and file drops.
- `npm run test:demo`: demo build and 16 desktop/mobile cases passed at `/upscale-compare/`.
- 90 local suite cases passed. Formatting and `git diff --check` passed; `npm audit --audit-level=high` reports zero vulnerabilities.
- Initial hosted Firefox validation passed keyboard adjustment and all panning cases, but exposed a test assumption: letter input after pointer focus does not necessarily enable `:focus-visible` in Firefox. The regression now accepts that browser modality difference, still checks zero full-height accent lines, and requires a visible handle ring after actual Tab/Shift+Tab re-entry. The revised targeted Chromium tests and rebuilt 16-case demo suite passed. Final hosted Firefox results are tracked in the Validate checks and Validation section of [PR #5](https://github.com/Kuba25x/upscale-compare/pull/5). Local Firefox download remains blocked by environment policy.

Previous panning fix and community review, 2026-10-26:

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

- Demo publishing and remote comparison viewing are intentionally disabled. This fix has not been deployed or live-tested on Pages; production-bundle subpath tests run locally.

- No production deployment, Cloudflare account permission check, real Turnstile smoke test, or provider CPU budget benchmark has been performed.
- JPEG/WebP content is structurally validated, not fully decoded server-side. PNG additionally validates its bounded complete decompressed raster. Animated, interlaced PNG, or rotated/mirrored EXIF uploads are not accepted for publication.
- Browser color management applies; HDR/raw-color analysis is outside scope. Safari and physical devices have not been tested. Firefox CI verification covers the targeted viewer regressions.
- A crash before a pending row is inserted can conservatively over-count quota; the documented disabled-upload reconciliation procedure handles this.
- Per-IP limits do not stop distributed attacks or cap provider request costs. Large PNG validation may exceed Workers Free CPU allowance. Production requires operator contacts, monitoring, provider quota review and approval.
- No automatic expiration: active links persist until owner/operator deletion. Local unpublished state is intentionally lost on refresh.

## Exact next steps

1. Review [PR #7](https://github.com/Kuba25x/upscale-compare/pull/7), pushed on `fix/divider-pointer-focus` with `Fixes #6`. Local validation is complete (92 passing suite cases).
2. Inspect the latest Validate checks and the PR Validation section for hosted Chromium/Firefox results, including pointer/keyboard transitions in normal and demo builds. The combined configured suite contains 106 cases (51 unit/API + 31 regular browser + 24 demo browser).
3. Leave the PR unmerged, Issue #6 open, and do not deploy. The owner decides when to merge and publish after verification.
4. Continue from the existing branch; preserve demo/production separation, community panning attribution, AGPL-3.0 and all Cloudflare safeguards. Do not start unrelated Issues without the owner's prioritization.
