# Testing and verification

## Automated checks

```bash
npm run build
npm test
npm run test:e2e
npm run test:demo
npm run test:diagnostics
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

CI enables Firefox automatically. With Firefox enabled, the suites contain 55 full-stack browser cases and 49 demo cases, in addition to 68 unit/API tests and 7 diagnostic browser cases. The managed development environment could not download Firefox because its official download domains are blocked; use the PR's hosted CI result as the evidence for Firefox execution. `FIREFOX_PATH` can optionally select a Playwright-compatible Firefox binary.

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

The tests cover repeated slow/fast/batched input, proportional zoom, midpoint anchoring, either side and panel-seam crossing, contact replacement/cancellation, capture loss, compatibility-event interference, wheel recovery and mouse double-click recovery. Four new geometry cases check source anchors at different DPR values. Do not treat a green desktop Firefox job as proof that Issue #8 is resolved on Android. Exact final results will be linked in the draft PR.

Pinch candidate local validation on 2026-10-27: `npm run build`, `npm test` (55), `npm run test:e2e` (33) and `npm run test:demo` (26) passed: **114 local suite cases**. Formatting and `git diff --check` passed. The hosted configuration contains 142 cases including desktop Firefox; exact hosted execution evidence is linked from [draft PR #9](https://github.com/Kuba25x/upscale-compare/pull/9). At that candidate checkpoint, actual Firefox for Android had not been tested; the subsequent reporter retest failed, as described below.

## Local diagnostic recording

`npm run test:diagnostics` starts a dedicated development demo on port 5175. It verifies explicit activation, phone downloads, local-HTTP copy fallback, exclusion of image/naming/metadata/URL/storage markers, absence of log requests, native touch/capture/cancel traces, and exact gesture-result parity with recording disabled. The production-demo suite separately proves that `?diagnostics=1` cannot enable the recorder in a built demo. Unit cases cover guard combinations, browser identity minimization, bounded memory, reset/stop semantics, frozen final state and non-finite numeric evidence.

CI also runs the diagnostic UI in desktop Firefox. This is recording verification only: the reporter's actual Android retest failed, and Issue #8 remains unresolved. See [diagnostic operation and schema](GESTURE_DIAGNOSTICS.md) before interpreting updater evaluations as applied commits. No new gesture formula is introduced by this phase.

Diagnostic-stage local verification on 2026-10-27: production frontend/Worker build passed; 65 unit/API + 33 regular browser + 27 production-demo + 5 diagnostic browser cases passed (**130 total**). Formatting and `git diff --check` passed. The configured CI total is 160 cases including desktop Firefox diagnostics; exact hosted results are linked from PR #9's Validation section. This diagnostic stage does not claim to fix the reporter's Android issue.

## Native-log input coherence regression

[Device-log analysis](PINCH_LOG_ANALYSIS.md) documents the confirmed stale-secondary-pointer cause. `tests/shared/atomic-pinch.ts` replays its reduced delivery pattern with complete Touch snapshots and sparse secondary Pointer Events; it was executed red before the fix and green afterward. The shared cases also cover independent Touch/Pointer IDs, TouchList reordering, Chrome-style dual pointer delivery without double processing, contact replacement/third contacts, cancellation, one-finger pan and mouse recovery. They run in regular/demo Chromium and desktop Firefox projects. Unit cases check immutable, stable-identity snapshot replacement. Native Chromium touch tests additionally verify divider dragging after pinch.

A private workspace replay of all four supplied streams checked 2,465 touch frames, with largest absolute scale error 1.11e-16. This is handler replay with a synthetic capture shim and placeholder images, not an actual Firefox Android run. Patched-device confirmation is outstanding. Exact final automated counts are recorded in PR #9's Validation section.

Native-log fix validation on 2026-10-27: build passed; 68 unit/API + 37 regular Chromium/HiDPI/mobile + 31 production-demo + 5 diagnostic browser cases passed (**141 local cases**). Formatting and `git diff --check` passed. The configured hosted total is 179 including desktop Firefox. Full actual-device log replay and reduced red/green reproduction are described in the analysis; the patched phone still needs a confirmation run.
