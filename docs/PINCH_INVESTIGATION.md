# Pinch gesture investigation

Status: the reporter has confirmed the complete-touch-snapshot fix in [PR #9](https://github.com/Kuba25x/upscale-compare/pull/9) on the actual Xiaomi/Firefox device in both modes, with Chrome also working. See [final analysis and confirmation](PINCH_LOG_ANALYSIS.md). [Issue #8](https://github.com/Kuba25x/upscale-compare/issues/8) stays open until merge. The failed initial candidate and diagnostic collection below are investigation history.

## Native logs establish the cause

The four subsequent Xiaomi Firefox/Chrome logs identify mixed-age secondary Pointer Event positions as the source of the jumps. See [device-log analysis](PINCH_LOG_ANALYSIS.md) for direct evidence and the complete-touch-snapshot input fix. The earlier injected-event defects below are real but do not explain the supplied native recordings. The reporter subsequently confirmed the patched device behavior; see the linked analysis.

## Historical retest: initial candidate failed

The reporter tested the candidate in a locally served demo on **Xiaomi 15T / Android 16 / Firefox 158.0.2**. The main scale/position instability persists in both modes; Chrome on that phone remains stable. The mechanisms below were reproduced in controlled tests, but they do not explain the complete native-device failure. At that checkpoint Issue #8 was unresolved and PR #9 remained a draft.

The next step at that checkpoint was [opt-in local diagnostics](GESTURE_DIAGNOSTICS.md). Four matched logs were subsequently collected, analyzed and used to prepare the verified fix.

## Evidence and scope

The supplied `firefox_mobile_record.mp4` was inspected as a frame sequence (18.5 seconds, 1920 × 1080, 30 fps). It shows large image scale/position changes in both modes while the browser/app chrome stays the same size. A recording does not expose pointer, wheel or compatibility-click events, so it cannot establish which event stream causes the Android symptom. The media was not added to the public repository.

Recording SHA-256: `84ce5765a8435f12022060065fcef48aa98000e5f4c849b34adcfe57f3856f86`.

The following defects were reproduced against main at `a79f6a5`:

| Confirmed defect                                       | Reproduction and change                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A double-click can overwrite pinch zoom                | After a synthetic 150% pinch, an injected `dblclick` resets it to 100%, including after contact release. Remember a multi-contact gesture until a new pointer gesture starts, and ignore its compatibility double-click tail. A new mouse gesture still supports double-click zoom; normal single-contact taps start a fresh sequence.   |
| Wheel and pointer streams can both change pinch zoom   | Injecting a wheel event while the pointer pinch is active applies another scale factor. The pointer gesture now owns zoom while its contacts remain. Desktop/trackpad wheel input resumes after release. This injection demonstrates handler interference, not that Android Firefox emits this exact combination.                        |
| Side-by-Side can change its anchor panel mid-gesture   | Moving a constant-span pair 40 CSS pixels across the seam produced a displacement of -11 instead of +40. Lock the reference panel when the second contact joins; release that choice when fewer than two contacts remain.                                                                                                                |
| Intermediate pixel snapping can drift the pinch anchor | A moving-midpoint regression exceeded its 1.1 CSS-pixel tolerance. `pinchAt` now computes the source point from the previous rendered origin and applies the new midpoint/scale directly, avoiding an intermediate snapped pan. Final integer zoom still uses the existing physical-pixel snapping.                                      |
| Development wheel listeners can be duplicated          | A 150% zoom plus delta -300 yielded about 368.94% instead of a single factor yielding 235.25%. React StrictMode cleanup can see a cleared ref. Capture the actual DOM element when installing the listener and remove from that same element. This development-only multiplier is not claimed as the cause on the production Pages demo. |

The existing distance-ratio calculation and copied pointer positions were inspected. Tests cover queued updates in a single browser task; there is no evidence that React replays a mutable pointer map inside the pinch updater. The fix keeps position/panel snapshots outside functional state updaters and leaves wheel geometry, keyboard zoom, file handling and backend behavior intact. `touch-action: none` remains scoped to the viewer; page zoom is not globally disabled.

## Regression coverage

- Seven shared handler cases run in Chromium and desktop Firefox against regular and demo builds. Synthetic touch IDs use a capture-bookkeeping shim because untrusted contacts have no browser-native capture. They verify real React handlers and rendered image geometry, not Android's touch/APZ pipeline.
- Slow sequential and fast batched streams repeatedly expand/contract, check exact distance ratios and midpoint anchors, and use both image regions.
- Finger addition, removal, replacement, third contacts, cancellation, capture loss, stale post-release moves and blur are exercised. Normal wheel and real mouse double-click are checked after touch completion.
- Two additional Chromium CDP touch cases per build use native touch dispatch at a mobile viewport, repeat slow/rapid gestures in both modes, cancel/end contacts, assert synchronized geometry/source-pixel sizes and verify that browser viewport scale stays unchanged.
- Four unit cases check rendered source-point anchoring at DPR 1, 1.25, 2 and 3. All existing pixel, divider, panning, focus, upload, share/API and demo-network tests remain enabled.

## Device verification checklist

On 2026-10-27, the reporter confirmed the latest fix (`e5b20cd`) on Xiaomi 15T / Android 16 / Firefox 158.0.2: pinch expansion and contraction are smooth, without scale or position jumps, in both Split Screen and Side-by-Side. Chrome on the same phone also remains correct. This is reporter-executed physical-device verification, distinct from CI and synthetic replay.

Retain the following checklist for future gesture changes. Automated desktop coverage alone cannot establish Android behavior.

For a local demo on a computer and phone on the same network, check out the PR branch, run `npm ci` and `npm run dev:demo`, then open `http://<computer-LAN-IP>:5173/upscale-compare/` on the phone. No backend is needed. No public deployment is required for this check.

1. Record Firefox version, Android version and phone model; compare with Chrome on the same device.
2. Use two identical-size screenshots. In both modes, perform slow expansion/contraction, fast reversals and successive gestures with short pauses.
3. Lift either finger, pan with the remaining finger, add a new second finger and repeat. Cancel/restart a gesture by switching applications. Test both sides and across the Side-by-Side seam.
4. Verify stable scale/position, synchronized views, divider touch dragging, normal zoom buttons, and fit/100% source-pixel views.
5. If the issue persists, capture a new recording and, where remote debugging is available, an event trace of `pointerdown/move/up/cancel`, capture loss, `wheel`, `dblclick`, current zoom and `visualViewport.scale`. This will distinguish compatibility events, native viewport zoom and pointer lifecycle differences.

Do not close the issue merely because automated checks pass. Merge and deployment remain owner decisions after appropriate verification.

## Executed local checks

On 2026-10-27, the frontend/Worker production build and all 114 local suite cases passed (55 unit/API, 33 regular Chromium/HiDPI/mobile, 26 production-demo desktop/mobile). Formatting and `git diff --check` passed. Baseline injected-event and panel-seam cases were executed and failed before the fix. At that initial checkpoint Android Firefox verification was outstanding. The later full-touch-snapshot fix is now confirmed by the reporter, as described above.
