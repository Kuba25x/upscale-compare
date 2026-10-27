# Device-log root cause: stale secondary pointer coordinates

[Issue #8](https://github.com/Kuba25x/upscale-compare/issues/8), [draft PR #9](https://github.com/Kuba25x/upscale-compare/pull/9). Device: Xiaomi 15T, Android 16; reported Firefox 158.0.2 (UA reports 158.0) and Chrome 154.0.0.0. All four supplied logs were parsed as data, not instructions. None is truncated or has dropped entries.

## Confirmed mechanism

Firefox's recorded `TouchEvent.touches` contains current positions for both contacts. Its `pointermove` stream often updates only one contact for many consecutive frames. The viewer used a map updated exclusively by individual Pointer Events, combining the fresh primary position with a stale secondary position. A later secondary pointer event abruptly corrects the cached distance and midpoint, creating a scale/position jump.

Chrome delivered enough individual pointer updates to keep the application's cached positions synchronized with the complete touch snapshots. The same assumption therefore appeared to work on Chrome.

For analysis, Touch identifiers were associated with Pointer IDs using their initial contact coordinates and lifecycle; the numeric ID spaces were not assumed to match. Each two-contact touchmove was compared with the application's recorded pointer cache:

| Recording            | Paired touchmove frames | Frames with cache error >5 CSS px | Frames >20 CSS px | Maximum contact error |
| -------------------- | ----------------------: | --------------------------------: | ----------------: | --------------------: |
| Firefox Split Screen |                     369 |                               245 |               177 |         90.450 CSS px |
| Firefox Side-by-Side |                     482 |                               387 |               315 |        177.980 CSS px |
| Chrome Split Screen  |                     445 |                                 0 |                 0 |          0.000 CSS px |
| Chrome Side-by-Side  |                     442 |                                 0 |                 0 |          0.000 CSS px |

### Specific jumps

- Firefox Split Screen, calculation sequence 2827 / commit 2829, about 16.275 seconds: current native touch span changes from 89.275 to 87.281 CSS px (ratio **0.977668**). The pointer-cache span instead changes from 166.858 to 88.125 (ratio **0.528146**). The committed zoom falls from 0.927255 to 0.489726. This is a stale-cache correction, not the proportional physical motion.
- Firefox Side-by-Side, calculation sequence 1743 / commit 1745, about 9.183 seconds: native touch span changes from 179.627 to 185.874 CSS px (ratio **1.034773**), but the cached span changes from 93.432 to 185.319 (ratio **1.983469**). Zoom almost doubles, from 0.197147 to 0.391034, for a real span increase of about 3.5%.

The midpoint is computed from the same mixed-age cache, so the error affects position as well as scale.

## Alternatives checked

- No wheel or double-click events appear in any recording. Earlier compatibility-event protections cannot explain these jumps.
- `visualViewport.scale` stays at 1 throughout. DPR is constant within each browser (Firefox 3.3333333333, Chrome 3.25). There is no viewport-scale or DPR transition causing the abrupt changes.
- Stage pointer capture is present in all paired touchmove frames. There are no rejected pointer moves or pointercancel events. Capture loss at normal contact release is not the jump trigger.
- Every pointer calculation has two development evaluations with identical before/after views in both browsers. They are StrictMode evaluations, not two chained scale applications. Committed zoom matches the erroneous distance ratio exactly.

## Input fix

When a native Touch Event stream is observed, image navigation uses complete, copied `touches` snapshots as its touch-motion source. Each snapshot refreshes all contacts together, keyed by Touch identifiers and preserving stable pair identity even if TouchList order changes. Pointer IDs remain separate for capture/lifecycle tracking.

- Touch Pointer Events remain observable and captured, but cannot apply a second pan/zoom after native Touch Events take ownership.
- Mouse and pen retain Pointer Event navigation. Environments emitting only Pointer Events keep their existing touch fallback; there is no browser-name/version check.
- Contact addition/removal/replacement rebases the contact set without transforming the image. Cancellation clears contacts; post-cancel moves cannot resurrect a gesture.
- A one-contact divider gesture remains a divider drag. A multi-contact image gesture involving the divider does not also drag it.
- The existing geometry, source-pixel snapping, synchronized view model and zoom limits are reused. This fixes the input-coherence assumption rather than clamping genuine motion or slowing down zoom.

Diagnostics additionally expose the authoritative touch-contact cache/distance and tag calculations with their `input` source. The legacy pointer cache may still lag on Firefox; it no longer drives touch motion once complete native snapshots are available.

## Verification and its limits

The new handler regression reproduces the device-log delivery pattern: update both native contacts while delivering only primary pointer moves, then refresh the secondary pointer. It fails before the fix and passes afterward. It uses deliberately different Touch/Pointer IDs and checks every distance ratio, midpoint anchoring and the lack of a late catch-up jump, in both comparison modes.

Additional cases check Chrome-style dual pointer delivery without double counting, reordered snapshots, either-finger release, one-finger pan, replacement/third contacts, cancellation, stale moves and mouse recovery. Native Chromium CDP tests also check divider dragging after repeated pinch gestures.

A private workspace replay fed the four captured coordinate/order streams through the patched viewer in Chromium with synthetic capture, placeholder images, a desktop viewport and an initial 100% view. Each touch frame's rendered zoom was compared with the complete-snapshot distance ratio (with normal zoom limits):

| Recording            | Touch lifecycle/move frames checked | Largest absolute zoom error |
| -------------------- | ----------------------------------: | --------------------------: |
| Firefox Split Screen |                                 595 |                1.39 × 10⁻¹⁷ |
| Firefox Side-by-Side |                                 673 |                1.11 × 10⁻¹⁶ |
| Chrome Split Screen  |                                 576 |                           0 |
| Chrome Side-by-Side  |                                 621 |                           0 |

All **2,465 frames** passed. This validates captured input order/coordinates and proportional scale; it is not original-device execution or an exact replay of the original image/viewport geometry. Original user logs are not committed to the public repository. Representative reduced regressions are committed instead.

Local production builds and 141 automated cases passed (68 unit/API, 37 regular browser, 31 production-demo, 5 diagnostics), plus formatting and `git diff --check`. Hosted results are linked from PR #9.

The cause is evidenced by real-device logs. **The patched app still needs confirmation on the actual Xiaomi/Firefox configuration** before calling the device issue fully resolved. Keep PR #9 draft and Issue #8 open pending that confirmation. Do not merge or deploy automatically.

## Source log fingerprints

- Firefox Split Screen: `a4f624e875821f774881bf8a4e8b4620d3a99d05de2b943521b34dab56040960`
- Firefox Side-by-Side: `22dbb91461d65a2df54004671c42c925e9111a9a2b8b4d874b56cbb2c51c00ff`
- Chrome Split Screen: `3a803a207a95e8756b8980531a9907e154e942dce4b5a36e9026036ec913cf80`
- Chrome Side-by-Side: `f45a378a89b4274c956b11ece062c2c9fc769f02272d6dd59a27b70b31efd420`
