# Testing and verification

## Automated checks

```bash
npm run build
npm test
npm run test:e2e
npm run test:sharing:local
npm run test:demo
npm run test:diagnostics
npm run format:check
npm audit --audit-level=high
```

Node.js 24 and system Chromium are used in the managed development environment. Playwright can also use its downloaded Chromium through `CHROMIUM_PATH`. The browser suite starts local Vite and Wrangler with a separate persisted state directory per run. Miniflare API tests use isolated in-memory D1 and R2. No Cloudflare account, production resources, or public upload endpoint is involved.

## Coverage

Stage-3 retry behavior and its limits are documented in [recoverable retries](PUBLICATION_RETRIES.md).
Stage-4 policy/accounting, stop/restart and billing limits are documented in [cost controls](COST_CONTROLS.md).
The production-build browser flow with offline verification is documented in [local sharing validation](LOCAL_SHARING_VALIDATION.md).
The original-file SHA-256, format/metadata and multi-DPR reconstruction matrix is documented in [original fidelity](ORIGINAL_FIDELITY.md), with the requested real-asset/device acceptance checklist.
Stage-7 [guarded operations](OPERATIONS.md) and [Free-only resource evidence](FREE_TIER_OPERATIONS.md) describe the deliberate deployment lock, expected failing readiness command and offline diagnostic.

- Geometry and schema: fit without cropping, DPR 1/1.25/2/3 source-pixel scaling, physical origin rounding, cursor anchor, shared pan deltas, bounded zoom and strict manifests.
- Image-content validation: full valid PNG, CRC corruption, truncation, trailing data, dimensions, pixel/file limits, decompression mismatch, spoofed HTML/SVG/GIF, actual generated JPEG/WebP fixtures and rotated EXIF rejection.
- Worker with real local D1/R2: publication, original byte identity, manifest restoration, safe headers/filenames, escaped social metadata, subpath redirect, deletion authorization, operator moderation, deletion/quota release, CORS/origin checks, spoofed MIME, malformed JSON/manifests, image counts, multipart/request limits, full storage, throttling, unknown IDs, production fail-closed behavior, concurrent quota reservation and concurrent deletion.
- Desktop browser: centered title and adjacent share/upload controls, no automatic upload, invalid/local upload, drag/drop, divider drag/keyboard, source-coordinate alignment, cursor zoom, synchronized panning/mode switching, four-image selection, renaming, metadata, replacement/mismatched dimensions, keyboard/fullscreen, publication consent, public direct navigation/refresh, API errors and owner deletion.
- Pixel assertions read actual browser screenshots and compare sampled rendered RGBA values to generated source pixels at 100%, on DPR 1, 1.25 and 2 in both Split Screen and Side-by-Side. These test display geometry and nearest-pixel behavior, not just DOM attributes.
- Mobile browser: 390 × 844 viewport with DPR 2, all main controls accessible, no horizontal document scrolling, touch divider, and actual emulated two-finger pinch events through Chromium's DevTools protocol.

Generated test patterns contain no private or third-party game assets. Browser screenshots/reports are ignored by Git and saved as CI artifacts.

## Executed results

Initial development checkpoint: 2026-10-26. Later viewer regressions and validation results are recorded below.

- Frontend and Worker TypeScript checks: passed.
- Vite production build and Worker bundle: passed.
- Unit + Miniflare integration suite: **51 passed** (including four demo configuration/API guard tests).
- Chromium desktop/HiDPI/mobile suite: **21 passed**, including exact RGBA checks in both modes at DPR 1, 1.25 and 2, owner deletion and the deleted-link page.
- Production demo browser suite: **14 passed** on desktop/mobile, with all unexpected API/external requests monitored and none observed. Total automated tests: **86 passed locally**.
- Full runtime and development dependency audit: **0 known vulnerabilities**.
- Desktop and mobile rendered screenshots: inspected against the supplied wireframes.
- Production repository-subpath browser smoke: passed (assets, centered landing, JPEG/WebP upload, 1:1 size and mode switching; no browser errors).
- Production configuration generation and Worker `deploy --dry-run` packaging: passed with dummy resource IDs and uploads disabled; no resources were created or deployed.
- [Hosted GitHub Actions Validate run #1](https://github.com/Kuba25x/upscale-compare/actions/runs/40389516336): **success** for commit `fd6655f46c642209f493e2a3f65d8d327541eb71`, including production builds, all unit/API/browser tests and the full dependency audit.

## Limits of verification

Mobile emulation is not a physical iPhone/Android device. Safari has not been tested; Firefox verification covers the targeted viewer regressions described below. The suite does not establish HDR/colorimetric accuracy, large-file performance on every machine, real production CPU/billing limits, real Turnstile account verification, production DNS/TLS, or actual R2/D1 account permissions. Cloudflare deployment and social-platform preview caches require approved production smoke tests.

Static GitHub Pages subpath output is checked separately during CI. Publishing uses original byte comparisons; no lossy round-trip is introduced by the app. Full JPEG/WebP decoding is delegated to the browser, while the server performs structural validation. See SECURITY.md and deployment docs for operational boundaries.

The test suite pins Miniflare to the same patched version bundled with Wrangler (`5.20261023.0-beta`) and uses its supported v4-options adapter. This avoids outdated image/network dependencies in the older stable Miniflare package; the lockfile records the exact tooling.

## Frontend-only demo verification

`npm run test:demo` builds with Vite mode `demo` and runs `playwright.demo.config.ts` against the static production preview at `/upscale-compare/`. It starts no Worker, D1, or R2 process. Each browser case intercepts requests, permits only the demo's own asset subpath (plus local object URLs), and fails if it attempts an API, short-link backend, or third-party verification request. Shared-link navigation and refresh are explicitly exercised.

The suite also verifies accessible sharing explanations, metadata/labels, four-image selection, addition/replacement, synchronized zoom/pan, divider interaction, physical source pixels, shortcuts/fullscreen, mobile overflow, and static favicon/license assets. Unit tests prove that both demo-mode activation mechanisms reject API helpers even if a backend URL is supplied, while normal production and local-development behavior are retained.

The generated demo bundle was additionally inspected: Vite asset paths include `/upscale-compare/`; runtime JavaScript includes no `http://localhost:8787` address or Turnstile script URL. The real GitHub Pages deployment is intentionally not dispatched during implementation.

## Native dragging and panning regressions

See [community patch review](PANNING_FIX_REVIEW.md) for attribution, reproduction evidence, and the limitations of the submitted two-drag test. `tests/shared/panning.ts` is run against both the regular viewer and the built demo. It checks repeated mouse panning after real multi-clicks, both image regions/modes and zoom changes, synchronized displacement, existing document selection, capture/blur/button cleanup, native `dragstart` cancellation, file-drop uploading, and focus recovery after editing a label.

Chromium runs these regressions by default. To add the Firefox projects on a machine with download access:

```bash
npx playwright install --with-deps firefox
RUN_FIREFOX=true npm run test:e2e
RUN_FIREFOX=true npm run test:demo
```

CI enables Firefox automatically. With Firefox enabled, the suites contain 63 full-stack browser cases, 37 local-production sharing cases and 49 demo cases, in addition to 300 unit/API tests and 7 diagnostic browser cases (456 configured cases; this is not a new hosted execution result). The managed development environment could not download Firefox because its official download domains are blocked; use the PR's hosted CI result as the evidence for Firefox execution. `FIREFOX_PATH` can optionally select a Playwright-compatible Firefox binary. The local-production sharing suite itself uses Chromium desktop/mobile emulation and DPR 1.25/2 restoration projects.

[Hosted Validate run #8](https://github.com/Kuba25x/upscale-compare/actions/runs/40410027435) passed all 94 cases on code commit `7ccd7a4`, including all four Firefox panning regressions against both the normal viewer and production demo.

## Split divider focus regression

[Issue #4](https://github.com/Kuba25x/upscale-compare/issues/4) was reproduced on main at `8d2e5d4` in Chromium. The global focus-visible rule outlined the full-height slider hit target; clipping hid its top/bottom edges and left two vertical accent lines. Merged [PR #5](https://github.com/Kuba25x/upscale-compare/pull/5) confined the ring to the circular handle. The baseline rendered-pixel test failed with 32 unwanted accent pixels; the outline fix removed them. [Hosted Validate run #14](https://github.com/Kuba25x/upscale-compare/actions/runs/40469175557) passed 102 cases for that fix, including Firefox.

[Issue #6](https://github.com/Kuba25x/upscale-compare/issues/6) clarifies the interaction requirement: clicking or dragging must not assign slider keyboard focus, even if the user subsequently presses a shortcut. The old `onPointerDown` explicitly focused the slider. The revised handler focuses the existing viewer stage instead, preserving shortcuts after label editing and giving Tab a predictable route into the slider. The handle CSS remains unchanged. A new regression was executed against unmodified main at `be6c936` and failed because the mouse-operated divider was still the active element.

`tests/shared/divider-focus.ts` runs against the normal viewer and production demo, in Chromium by default and Firefox when `RUN_FIREFOX=true`. It now verifies:

- Actual `document.activeElement`, `:focus-visible`, and handle outline visibility before/after pointer use and real keyboard input.
- No full-height accent pixels in browser screenshots above the handle.
- Mouse clicks and captured drags, including immediately during pointer-down; keys after editing a label; fullscreen, zoom, image swap and mode shortcuts without a slider ring.
- Real Tab/Shift+Tab access with a visible 2px handle ring, arrow/Shift+arrow/Home/End controls, and shortcuts while the slider has keyboard focus.
- Repeated keyboard → mouse → keyboard transitions: pointer input clears existing slider focus, viewer arrows pan both images, and Tab re-entry restores slider adjustment.
- Unchanged image coordinates during divider drag/keys. The mobile suite also verifies stage focus and no slider ring after touch dragging, then exercises synchronized pinch gestures.

The Firefox projects are named `firefox-viewer` and `demo-firefox-viewer`; both include panning and divider-focus regressions. Firefox and Chromium differ in their pointer-to-keyboard focus-visible heuristics; the new tests require the slider to remain unfocused after pointer use in both engines. Windows Chrome/DuckDuckGo and physical Windows devices are not available in this environment. No local Firefox execution is claimed; its official download domains are blocked by network policy.

Current pointer-focus validation on 2026-10-27: `npm run build`, `npm test` (51), `npm run test:e2e` (24) and `npm run test:demo` (17) passed: **92 local suite cases**. Formatting and `git diff --check` passed. The focus-ownership regression failed on unmodified main and passed with the fix. Exact hosted Chromium/Firefox execution results are linked in the Validation section of [PR #7](https://github.com/Kuba25x/upscale-compare/pull/7). The configured combined suite includes 51 unit/API, 31 regular browser and 24 demo browser cases.

## Pinch regression and device limits

See [pinch investigation](PINCH_INVESTIGATION.md) for baseline failures, the inspected user recording, candidate changes and the required actual-device checklist. `tests/shared/pinch.ts` uses synthetic contacts and a capture shim in desktop Chromium/Firefox; `tests/shared/touch-gestures.ts` uses native Chromium CDP touch dispatch in the mobile projects. Both run against regular and production demo builds. Neither executes Firefox for Android.

The tests cover repeated slow/fast/batched input, proportional zoom, midpoint anchoring, either side and panel-seam crossing, contact replacement/cancellation, capture loss, compatibility-event interference, wheel recovery and mouse double-click recovery. Four new geometry cases check source anchors at different DPR values. Do not treat a green desktop Firefox job as proof that Issue #8 is resolved on Android. Final automated and device results are recorded in PR #9.

Pinch candidate local validation on 2026-10-27: `npm run build`, `npm test` (55), `npm run test:e2e` (33) and `npm run test:demo` (26) passed: **114 local suite cases**. Formatting and `git diff --check` passed. The hosted configuration contains 142 cases including desktop Firefox; exact hosted execution evidence is linked from [PR #9](https://github.com/Kuba25x/upscale-compare/pull/9). At that candidate checkpoint, actual Firefox for Android had not been tested; the subsequent reporter retest failed, as described below.

## Local diagnostic recording

`npm run test:diagnostics` starts a dedicated development demo on port 5175. It verifies explicit activation, phone downloads, local-HTTP copy fallback, exclusion of image/naming/metadata/URL/storage markers, absence of log requests, native touch/capture/cancel traces, and exact gesture-result parity with recording disabled. The production-demo suite separately proves that `?diagnostics=1` cannot enable the recorder in a built demo. Unit cases cover guard combinations, browser identity minimization, bounded memory, reset/stop semantics, frozen final state and non-finite numeric evidence.

CI also runs the diagnostic UI in desktop Firefox. This verifies recording behavior; the first Android candidate failed before the later native-log fix. The reporter has now verified that fix on the actual device in both modes. See [diagnostic operation and schema](GESTURE_DIAGNOSTICS.md) before interpreting updater evaluations as applied commits. No new gesture formula is introduced by this phase.

Diagnostic-stage local verification on 2026-10-27: production frontend/Worker build passed; 65 unit/API + 33 regular browser + 27 production-demo + 5 diagnostic browser cases passed (**130 total**). Formatting and `git diff --check` passed. The configured CI total is 160 cases including desktop Firefox diagnostics; exact hosted results are linked from PR #9's Validation section. This diagnostic stage does not claim to fix the reporter's Android issue.

## Native-log input coherence regression

[Device-log analysis](PINCH_LOG_ANALYSIS.md) documents the confirmed stale-secondary-pointer cause. `tests/shared/atomic-pinch.ts` replays its reduced delivery pattern with complete Touch snapshots and sparse secondary Pointer Events; it was executed red before the fix and green afterward. The shared cases also cover independent Touch/Pointer IDs, TouchList reordering, Chrome-style dual pointer delivery without double processing, contact replacement/third contacts, cancellation, one-finger pan and mouse recovery. They run in regular/demo Chromium and desktop Firefox projects. Unit cases check immutable, stable-identity snapshot replacement. Native Chromium touch tests additionally verify divider dragging after pinch.

A private workspace replay of all four supplied streams checked 2,465 touch frames, with largest absolute scale error 1.11e-16. This is handler replay with a synthetic capture shim and placeholder images, not an actual Firefox Android run. The reporter has now confirmed the fix on the actual device; see the linked analysis. Exact final automated counts are recorded in PR #9's Validation section.

Native-log fix validation on 2026-10-27: build passed; 68 unit/API + 37 regular Chromium/HiDPI/mobile + 31 production-demo + 5 diagnostic browser cases passed (**141 local cases**). Formatting and `git diff --check` passed. The configured hosted total is 179 including desktop Firefox. Full actual-device log replay and reduced red/green reproduction are described in the analysis; the reporter subsequently confirmed the patched phone in both modes, and Chrome remained correct.

## Final review and device acceptance

On 2026-10-27, the reporter confirmed the latest fix (`e5b20cd`) on Xiaomi 15T / Android 16 / Firefox 158.0.2: pinch expansion and contraction are smooth, without scale or position jumps, in both Split Screen and Side-by-Side. Chrome on the same phone also remains correct. This is reporter-executed physical-device verification, distinct from CI and synthetic replay.

Hosted Validate run #22 passed all 179 cases on the verified code. The strengthened production-demo guard also checks that the diagnostic query cannot install document input or visual-viewport observers after image upload and mode switching. The development-only diagnostic tool is retained for optional future investigations; it is inactive in public production builds. Issue #8 remains open until merge; the owner controls merge and deployment.

## Upload and image resource bounds (Share Comparison stage 1)

See [resource limits](RESOURCE_LIMITS.md) for the design, ceilings, overload behavior and local diagnostic measurements. New coverage exercises container item limits, bounded decompressor input, a complete 8K raster, exact byte limits, fragmented/ambiguous multipart bodies, receive timeout/cancellation and per-isolate admission. Local workerd integration includes two 20 MiB originals in one complete 40 MiB publication, four-image uploads, concurrent publications and rejection before quota or R2 writes.

Validation on 2026-10-27: full build and typechecks passed; 121 unit/API, 37 Chromium/HiDPI/mobile E2E and 31 production-demo cases passed (189 cases). The many-empty-IDAT regression failed against the baseline implementation because it accepted the file; the same test passed after the fix. Both publication/restoration and owner-deletion browser smoke cases passed again against the final Worker. Formatting and diff whitespace checks passed. Firefox, diagnostic browser cases, hosted CI and production resource limits were not revalidated in this stage.

## Publication and cleanup recovery (Share Comparison stage 2)

[Publication recovery](PUBLICATION_RECOVERY.md) describes the migration, state machine and remaining cross-service boundaries. The dedicated integration suite wraps real local D1/R2 calls to fail before execution or after a successful commit. It tests failed insert/reservation triggers, capacity races and ID collisions, lost acknowledgments, all four R2 write positions, failed compensating deletion, atomic quota release rollback, missing ledger, legacy migration/accounting, stale candidates, late-object grace, concurrent cleanup and fairness with a persistently failing full batch at the next hourly run. No production fault-injection endpoint is added.

On 2026-10-28, build/typechecks, 158 unit/API cases (37 new), 37 Chromium/HiDPI/mobile E2E cases and 31 production-demo cases passed. Fresh migrations were also applied with local Wrangler in an isolated state directory. The stage-1 40 MiB original-byte round trip remains part of the passing API suite. Production failure semantics, CPU/cost, Firefox and diagnostic browser cases were not revalidated here.

## Recoverable publication retries (stage 3)

On 2026-10-28, full build/typechecks, **189 unit/API cases** (31 new), **45 Chromium/HiDPI/mobile E2E cases** (8 new), and **31 production-demo cases** passed: 265 local suite cases. The eight retry E2E cases passed again against the final result protocol. Formatting and `git diff --check` passed. Migrations 0001–0003 also passed through fresh isolated local Wrangler storage; the existing legacy-row upgrade test applies all migrations and preserves manifests, deletion hashes, states and quota.

Real local D1/R2 fault coverage includes lost INSERT/activation acknowledgments, marker-trigger rollback, concurrent same-operation callers (one R2 writer/reservation), full-capacity retries, failed/deleted tombstones, conflicting content/capabilities and bounded expiry cleanup. API checks cover normalized metadata/transport exclusions, malformed/expired/future identifiers, pending status, CORS and separate recovery throttling. Browser checks intercept lost success responses and blocked/failing storage, recover after a landing-page refresh, retry an unreceived upload with the same identifier, avoid pending reuploads, retain unresolved keys and require consent for a new terminal-state operation.

Production-style single-use challenge cases use a **local transport fake**: first publication verifies, an identical retry/result check does not reverify, a new operation cannot reuse the consumed token, an unrecorded attempt can retry with a fresh token, and result recovery works with uploads and verification disabled. No actual Turnstile endpoint/account is contacted. The 40 MiB original-byte round trip remains passing. No new CPU/memory benchmark, production provider verification, Firefox/diagnostic browser execution or hosted-CI success is claimed here.

## Cost controls and emergency publishing stop (stage 4)

On 2026-10-28, **235 unit/API cases** (46 new), **45 Chromium/HiDPI/mobile E2E cases** and **31 production-demo cases** passed: 311 local suite cases. Full production build, frontend/Worker typechecks, formatting and `git diff --check` passed. Migrations 0001–0004 passed through fresh isolated local Wrangler state. Production configuration packaging with dummy IDs also passed using `wrangler deploy --dry-run`, without deployment or resource creation.

The 37 cost-control cases use actual local D1/R2. New HTTP fault tests call the real handler in Node with instrumented bindings; existing API tests also exercise the budgeted path inside workerd. Checks include default zero/paused policy, invalid/zero existing limits, concurrent global admissions/byte caps, UTC boundaries, non-refunded invalid/failing work, publication/quota/retry atomicity, failed/deleted reservations, authorization before D1, lost stop/admission acknowledgements, fences during body intake and image writes, stop/resume before insertion/activation, missing state/D1 failure, private recovery/deletion during exhaustion, R2 GET/HEAD accounting, corrupt object sizes and independent retention cleanup. Nine production/local configuration cases keep public hostnames/logging/uploads disabled, reject invalid optional paid CPU caps and refuse remote arguments to the local bootstrap.

Existing stage-1 resource ceilings and complete 40 MiB original-byte round trip remain passing, along with stage-2 cleanup and stage-3 recovery behavior. The browser server now explicitly configures only its isolated local policy; production budgets are not selected by tests. No new CPU/memory/billing benchmark, hosted-CI success, Firefox/diagnostic execution, live edge rule, provider outage test, notification setup or paid plan activation is claimed.

## Production sharing validated locally (stage 5)

On 2026-10-28, full production build/typechecks, **245 unit/API cases**, **45 Chromium/HiDPI/mobile E2E cases**, **20 production-sharing browser cases** and **31 production-demo cases** passed: **341 local cases**. Formatting and `git diff --check` passed. There are 10 new API and 20 new browser cases; the existing complete 40 MiB original-byte round trip and previous-stage safeguards remain passing.

The new `npm run test:sharing:local` target builds two optimized production frontends (dummy site key/missing key) at `/upscale-compare/`, using the real Worker in production mode, fresh local D1/R2 and test-only verification transports. Browser cases cover consent, verification expiry/retry and SDK failure/lifecycle recovery, readiness/CORS/stop failures, lost-response/refresh recovery, private key backup, public redirect/refresh and owner deletion. API cases reject invalid provider status, schema, hostname/action, malformed/failed/timed-out responses and unavailable verification configuration without creating publication state. Two SDK and three API/readiness regressions were observed failing on the stage-4 implementation before the fixes.

See [the local validation guide](LOCAL_SHARING_VALIDATION.md) for isolation details and evidence boundaries. This is not live Turnstile, account-permission, edge/DNS/TLS, production billing/CPU or actual-device validation. No new CPU/memory benchmark, local Firefox/diagnostic run or subsequent-stage fidelity matrix is claimed; hosted CI results belong to the PR.

## Original files and comparison restoration (stage 6)

On 2026-10-28, final production build/typechecks, **277 unit/API**, **45 regular Chromium/HiDPI/mobile E2E**, **37 production-sharing browser** and **31 production-demo cases** passed: **390 local cases**. Formatting and `git diff --check` passed. The stage adds 32 API and 17 browser cases; all application/Worker code remained unchanged because the tested preservation/restoration paths already passed.

Eight generated source files (76,355 bytes total) cover RGBA/indexed/16-bit/4K PNG, baseline/progressive JPEG and lossy/lossless WebP, with transparency, ICC, EXIF orientation 1 and text. API tests assert golden SHA-256 and exact source/R2/HTTP bytes, metadata/order for 2–4 mixed originals, safe GET/HEAD headers and sizes/quota. A 12-case configuration matrix preserves full numeric precision, Fit/explicit zoom, mode, boundary divider and selected indices. Nine orientation cases refuse publication without creating storage state. Fixture regeneration reproduced the same hashes/catalog.

Production browser cases compare encoded-byte and decoded-RGBA hashes, entered labels/metadata, real image geometry and public 100% screenshot pixels across desktop DPR 1/1.25/2 and mobile emulation. Panned Fit and explicit views survive canonical-link navigation and refresh; visitor changes leave the public manifest unchanged, and a missing original refuses partial restoration. Existing 40 MiB original-byte and 8K raster validation remain passing.

See [the fidelity contract and acceptance checklist](ORIGINAL_FIDELITY.md). No real user screenshots, physical devices, new local Firefox/diagnostic runs, production provider checks, colorimetric/HDR verification or CPU/memory/billing benchmarks are claimed. Hosted CI is reported separately on the PR; no next stage or deployment was started.

## Guarded Free-only production operations (stage 7)

On 2026-10-29, full production build/typechecks, **300 unit/API** (23 new), **45 regular Chromium/HiDPI/mobile E2E**, **37 production-sharing** and **31 production-demo cases** passed: **413 local cases**. Formatting and `git diff --check` passed. Offline production config generation with dummy IDs and Wrangler `deploy --dry-run` packaging passed; no deployment, remote migration or resource operation was performed.

Twelve new operations-guard cases enforce the zero-charge/Free-only policy, refuse record/environment/CLI overrides, check main-only workflow ordering, keep demo independent and forbid automatic remote migrations. Ten integration cases exercise actual local D1/R2: bounded rate-row deletion with unchanged expiry cutoff/eventual progress, four-original binding-call ceilings with one production-verification reserve, complete 10-candidate cleanup success/failure/lost-ack paths (at most 44 calls), independent cleanup after retention failure and read-only aggregate SQL without manifests, capabilities or network identifiers. The rate-retention regression failed on the former unbounded DELETE (zero expired rows remained instead of 150), then passed with the 100-row batch. A production-mode verifier redirect case passed without following to another host.

`npm run ops:check` returned the required nonzero blocked result. The offline Node probe ran three rounds each on generated 4K, 8K and 20 MiB PNGs; exact CPU samples and memory-evidence limits are in [the resource report](FREE_TIER_OPERATIONS.md#repeatable-local-evidence). This is process-level component evidence, not Cloudflare CPU, full HTTP timing or peak 128 MB isolate certification. No timing thresholds are added to CI. The original 40 MiB byte round trip and prior recovery/cost/fidelity tests remain passing.

Official Free allowances, R2 subscription/pricing and budget-alert semantics were rechecked on 2026-10-29. Provider/account usage, real Free-edge CPU/memory, live notifications, R2 zero-overage protection and real-device/source acceptance remain unverified. No new local Firefox/diagnostic-browser execution or hosted-CI success is claimed; hosted results are separate. No stage 8 or production operation was started.
