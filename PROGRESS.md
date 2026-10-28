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

Share Comparison stages 1–4 are merged through PRs #10–#13. Stage 5, **Validate production sharing flow locally**, starts from `origin/main` at `305ec97` on `test/production-sharing-flow`. It adds built-production subpath browser tests against a production-mode local Worker with offline verification doubles, plus regressions/fixes for SDK loading/retry and strict server verification/readiness. See [local sharing validation](docs/LOCAL_SHARING_VALIDATION.md). Existing resource, cleanup, retry and cost controls stay in force. Only stage 5 is authorized; no subsequent stage, merge, deployment, paid service or production budget activation has been started.

The following viewer verification is historical; PR #9 has merged into main.

Four actual-device logs now confirm the cause of Issue #8: Firefox's secondary Pointer Event coordinates remain stale while Touch Events already expose both current contacts. A late pointer refresh produces a false large distance/midpoint change. Chrome's cache matches the full touch snapshots. See `docs/PINCH_LOG_ANALYSIS.md` for counts, precise event/commit sequences and log hashes.

The current fix drives native touch navigation from complete copied Touch Event snapshots, without matching Touch IDs to Pointer IDs. Pointer Events still track capture/lifecycle, mouse/pen and pointer-only fallback; they cannot double-apply native touch motion. Stable-identity snapshots rebase on contact changes, preserve one-finger/divider controls, and clear on cancellation. Existing geometry and diagnostics are retained.

The new representative device-pattern regression fails before this fix and passes in both modes afterward. A private Chromium replay of all four supplied streams checks 2,465 touch frames against full-snapshot scale ratios, with maximum error 1.11e-16. This is coordinate/order replay with placeholder images, not a new actual-device test. On 2026-10-27, the reporter confirmed the latest fix (`e5b20cd`) on Xiaomi 15T / Android 16 / Firefox 158.0.2: pinch expansion and contraction are smooth, without scale or position jumps, in both Split Screen and Side-by-Side. Chrome on the same phone also remains correct. This is reporter-executed physical-device verification, distinct from CI and synthetic replay. PR #9 is now merged; its device verification remains historical evidence. Raw logs are not committed publicly.

The previous community panning fix remains intact, including its attribution and review in `docs/PANNING_FIX_REVIEW.md`.

Development organization: search existing GitHub Issues before creating a substantive bug/feature report; use existing labels, keep unrelated problems separate, and link resolving PRs. Do not close an issue before verification and merge, create retroactive issues for finished work, or start other issues without the owner's prioritization.

No merge or deployment is authorized. Preserve existing demo/production modes and Cloudflare security behavior.

## Completed features

- Candidate pinch isolation, fixed reference panel, direct rendered-source anchoring and reliable wheel-listener cleanup, with detailed investigation/device-verification documentation. The later full-touch-snapshot fix is verified by the reporter on actual Android Firefox in both modes.

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

Share Comparison stage 5, 2026-10-28:

- Full production build and frontend/Worker typechecks passed. The final local suites passed **245 unit/API cases**, **45 Chromium/HiDPI/mobile E2E cases**, **20 built-production sharing cases** and **31 production-demo cases**: **341 cases**, including 10 new API and 20 new browser cases.
- Production sharing runs optimized bundles at the repository subpath against the actual production-mode Worker, fresh local D1/R2 and offline verification doubles. Coverage includes consent, token expiry/rejection, widget loading/lifecycle failures, CORS, unavailable configuration, emergency stop, lost-response/refresh recovery, private key backup, public refresh and owner deletion.
- Two SDK failure/reopen regressions and three strict-verification/readiness regressions were executed red on the stage-4 implementation and green after the fixes. Provider transport/HTTP/JSON/hostname/action/timeout failures leave no publication rows, retry markers, quota reservation or objects.
- Formatting and `git diff --check` passed. Existing 40 MiB original-byte, resource, cleanup, retry and cost-control coverage remains passing. No real provider request, production resource/configuration change, paid-service activation, new CPU/memory benchmark, local Firefox/diagnostic execution or stage-6 image-fidelity matrix is claimed. Hosted CI is reported separately on the PR.

Share Comparison stage 4, 2026-10-28:

- 235 unit/API cases passed (46 new): real local D1/R2 concurrent admissions/reservations, zero/invalid limits, conservative non-refunds, UTC reset, stop authorization/durability, generation fences after intake/before insertion/at activation, D1 failure/missing control, public-read/R2 budgets, HEAD/size checks and aggregate retention. Configuration tests keep production closed and refuse invalid optional paid CPU settings/remote local-bootstrap arguments.
- 45 Chromium/HiDPI/mobile E2E cases passed with the explicit isolated local policy bootstrap. The 40 MiB original-byte round trip, stage-2 cleanup and stage-3 result/key recovery remain passing.
- Full build/typechecks, 31 production-demo cases, formatting and whitespace checks passed: 311 cases across the main local suites. All four migrations passed through fresh isolated local Wrangler state. Production config packaging passed with dummy IDs using `wrangler deploy --dry-run`; no deployment/resource operation was performed.
- Provider pricing/allowances and alert semantics were checked against official documentation; recommendations are not applied budgets or paid-service authorization. No new CPU/memory/billing benchmark or provider/edge deployment is claimed.

Share Comparison stage 3, 2026-10-28:

- 189 unit/API cases passed (31 new), including actual local D1/R2 failures with committed INSERT/activation acknowledgments lost, transactional marker rollback, concurrent same-operation writers, full-capacity retries, conflict/private-key checks, canonical request matching and bounded marker expiry.
- 45 Chromium/HiDPI/mobile E2E cases passed (8 new), including credentials saved before upload, a lost success response without reupload, reload/landing recovery and deletion, same-identity retry, pending checks, blocked/full storage, changed settings and renewed consent after a terminal result.
- Full production build/typechecks and 31 production-demo browser cases passed (265 cases across the unit/API, full E2E and demo suites). All eight retry browser cases passed again against the final result protocol. Formatting and `git diff --check` passed; migrations 0001–0003 passed through fresh isolated local Wrangler storage.
- Production-style verification tests use a local single-use transport fake, including an already-consumed challenge and recovery with uploads/verification disabled. No real Turnstile or Cloudflare account was contacted.
- The existing 40 MiB original-byte round trip and stage-1/2 recovery/resource cases remain passing. No new CPU/memory benchmark or production provider/Firefox verification was claimed at the stage-3 checkpoint; cost controls were still later work at that point.

Share Comparison stage 2, 2026-10-28:

- Full build and frontend/Worker typechecks passed; 158 unit/API cases passed, including 37 new recovery/migration/fault-injection cases.
- 37 Chromium/HiDPI/mobile E2E and 31 production-demo browser cases passed (226 cases across these suites).
- Real local D1/R2 faults were injected before/after operations, including committed writes with lost responses. Coverage includes quota/row atomicity, every image-write position, failed compensation, cleanup rollback and missing ledger, migration compatibility, stale candidates, late objects, persistent-failure fairness and concurrent deletion/maintenance.
- Both migrations also passed through local Wrangler in an isolated state directory; no remote database was contacted.
- Production resources, provider failure/latency semantics, Firefox and diagnostic browser cases have not been revalidated in this stage. Hosted checks will be assessed on the PR separately.
- Publication-result/key recovery and global cost controls remain outside this stage.

Share Comparison stage 1, 2026-10-27:

- Added container structure ceilings and pull-based, 8 KiB PNG decompressor input.
- Replaced native multipart buffering with one bounded body buffer and original-byte slices; added bounded publication admission, receive deadlines and cancellation handling.
- Operator settings may lower the existing 20 MiB / 40 MiB / 36 MP / 16,384-pixel ceilings, but cannot raise them.
- Full build and frontend/Worker typechecks passed; 121 unit/API tests, 37 Chromium/HiDPI/mobile E2E cases and 31 production-demo cases passed (189 cases, including 53 new unit/API cases).
- The many-empty-IDAT regression failed against the baseline validator (it accepted the file) and passed after the change. Local workerd accepted a complete 40 MiB publication and returned both 20 MiB originals byte-for-byte.
- Both publication/restoration and owner-deletion browser smoke cases passed again against the final Worker. No production CPU/memory margin, Firefox execution or hosted CI run is claimed for this stage.
- See docs/RESOURCE_LIMITS.md for local diagnostic measurements and remaining production verification requirements.

Current device-log fix, 2026-10-27:

- Four complete native logs analyzed; no dropped/truncated data. Firefox cache errors reach 90.450 / 177.980 CSS px; Chrome errors are zero.
- Device-pattern regression executed red before the fix and green afterward in both modes; native Chromium repeated gestures/divider and touch lifecycle cases pass.
- Four-stream Chromium replay: 2,465 touch frames passed proportional-zoom checks.
- Full build passed, including frontend/Worker typechecks and production bundles.
- `npm test`: 68 passed; `npm run test:e2e`: 37 passed; `npm run test:demo`: 31 passed; `npm run test:diagnostics`: 5 passed (**141 local cases**).
- Formatting and `git diff --check` passed. Hosted configuration contains 179 cases including desktop Firefox (68 + 55 + 49 + 7); exact CI evidence is linked from PR #9.
- Reporter physical retest passed on Xiaomi 15T / Android 16 / Firefox 158.0.2 in both modes; Chrome on the same phone also passed.

Previous local diagnostics, 2026-10-27:

- Initial `npm test`: 65 unit/API cases passed.
- Initial diagnostic browser suite: five desktop/mobile Chromium cases passed, including export, copy fallback, privacy, no requests and gesture-result parity.
- Full `npm run build` passed, including frontend/Worker typechecks and bundles.
- `npm test`: 65 passed; `npm run test:e2e`: 33 passed; `npm run test:demo`: 27 passed; `npm run test:diagnostics`: 5 passed (130 local cases total).
- Formatting and `git diff --check` passed. Hosted configuration includes 160 cases (65 unit/API + 47 regular browser + 41 demo browser + 7 diagnostics). Exact hosted results are recorded in PR #9's Validation section.
- The actual-device failure is user-confirmed. Do not mark the original problem solved based on these tests.

Previous pinch candidate investigation, 2026-10-27:

- Recording inspected; baseline compatibility-event and seam regressions fail before the fix. Seven targeted synthetic Chromium cases and two native Chromium CDP mobile cases passed after the candidate changes.
- `npm run build`: passed (frontend/Worker typechecks and production bundles).
- `npm test`: 55 passed, including four new geometry anchor cases.
- `npm run test:e2e`: 33 Chromium desktop/HiDPI/mobile cases passed.
- `npm run test:demo`: production demo build and 26 desktop/mobile cases passed at `/upscale-compare/`.
- 114 local suite cases passed; formatting and `git diff --check` passed. Hosted desktop Firefox validation is configured (47 regular browser + 40 demo browser + 55 unit/API = 142 cases).
- At the earlier candidate checkpoint, no actual-device test had been performed. The subsequent reporter retest failed; hosted desktop Firefox checks cannot establish device resolution.

Previous pointer/keyboard focus follow-up, 2026-10-27:

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
- Browser color management applies; HDR/raw-color analysis is outside scope. Safari has not been tested. The reporter verified pinch on the physical Xiaomi/Firefox and Chrome configuration described above. Firefox CI verification covers the targeted viewer regressions.
- A crash before a pending row is inserted can conservatively over-count quota; the documented disabled-upload reconciliation procedure handles this.
- Per-IP limits do not stop distributed attacks or cap provider request costs. Large PNG validation may exceed Workers Free CPU allowance. Production requires operator contacts, monitoring, provider quota review and approval.
- No automatic expiration: active links persist until owner/operator deletion. Local unpublished state is intentionally lost on refresh.

## Final review, 2026-10-27

On 2026-10-27, the reporter confirmed the latest fix (`e5b20cd`) on Xiaomi 15T / Android 16 / Firefox 158.0.2: pinch expansion and contraction are smooth, without scale or position jumps, in both Split Screen and Side-by-Side. Chrome on the same phone also remains correct. This is reporter-executed physical-device verification, distinct from CI and synthetic replay.

Final review found no new blocker in input ownership, stable touch snapshots, contact lifecycle/cancel, pointer capture/fallback, divider input or geometry. Production diagnostics are disabled by the development + demo + query guard: no recorder, diagnostic observers or UI. The production-demo regression now checks observer absence after upload and mode switches. Backend, dependencies, license and deployment triggers are unchanged.

## Exact next steps

1. PR #9 is ready for owner review; see its Validation section for final local and hosted results. Keep Issue #8 open until the verified solution is merged.
2. Merge and deployment are owner actions. Do not merge, deploy, activate cloud resources or create another issue/PR automatically.
3. Preserve the analysis, opt-in development diagnostics, image quality, attribution, AGPL-3.0 and backend safeguards. Raw user logs remain outside the public repository.
