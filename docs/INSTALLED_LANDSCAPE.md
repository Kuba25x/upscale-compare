# Installed mobile landscape display

## Window limits and the selected approach

Android and the browser own the app window, status/navigation bars and cutout
policy. In `standalone`, a browser may reserve those areas outside the web viewport.
`viewport-fit=cover` already opts the page into the available cutout area; it cannot
force Android to enlarge a restricted window. Removing CSS padding or sizing the
page to `screen.width` cannot recover pixels outside that window and can clip controls.

The existing minimalist action requests fullscreen on `document.documentElement`
and separately hides the interface with CSS. The reported device behavior shows
that this explicit request can unlock more display area there. The app now offers
the same window request **with the normal comparison interface retained**.

| Option                                      | Decision                                                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `standalone` with `viewport-fit=cover` | Preserve portrait launches, app identity/scope and browser-tab behavior. Use any area the browser exposes automatically.                                                                                                      |
| Manifest `display: fullscreen`              | Not selected. It changes launches in both orientations and is separate from the Fullscreen API. Cutout handling depends on browser/Android implementation; the manifest alone does not establish coverage.                    |
| User-initiated Fullscreen API               | Selected for an optional installed landscape action. Request the whole document with `navigationUI: 'hide'`, retaining the UI and existing layout. This is a browser request, not a guarantee about OS bars or cutout pixels. |
| Automatic orientation-triggered fullscreen  | Not supported by standard web APIs. Rotation does not provide the transient user activation required to enter fullscreen. No automatic click, first-touch interception, orientation lock or manifest rewriting is used.       |

References reviewed on 2026-11-18:
[manifest display modes](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display),
[Fullscreen API requirements and options](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen),
[Chromium cutout/inset implementation](https://chromium.googlesource.com/chromium/src/+/main/docs/ui/android/display_cutout.md)
and [reported fullscreen-PWA edge-to-edge issues](https://issues.chromium.org/issues/407420295).
An implementation document or engine test is not physical-device acceptance.

## Use

In an installed app window with a coarse primary pointer, rotate to landscape and
import images. The existing expand/shrink button opens **Fullscreen options**:

- **Fullscreen with controls** requests more screen space while retaining modes,
  uploads, image selection/labels, zoom, metadata and Help.
- **Minimalist mode** retains the existing comparison-only view and CSS fallback.
- **Exit fullscreen** returns from the full-controls session. Browser/system exit
  controls also work; a rejected application exit leaves the exit action reachable.

These are explicit button actions. There is no launch popup, extra toolbar button,
saved immersive preference or automatic re-entry. The full-controls session exits
on portrait rotation; returning to landscape requires another tap. Minimalist mode
keeps its existing behavior across rotations. The original controls remain in
portrait, ordinary browser tabs and mouse-first desktop windows.

If fullscreen is unavailable, its full-controls action is disabled. A rejected
request leaves the normal UI visible and reports the failure inside the options.
Minimalist mode remains available. An installation implemented only as a regular
browser shortcut may not report standalone mode and therefore keeps tab behavior.

## Insets, geometry and lifecycle

`useWebViewport` reads browser-provided `env(safe-area-inset-*)` values and refreshes
them on viewport/fullscreen changes. It remembers the standalone context during a
Fullscreen API session, when `display-mode` temporarily becomes `fullscreen`.
Physical orientation still comes from Screen Orientation, legacy angle or screen
dimensions; opening the software keyboard is not treated as a rotation.

Existing safe-area CSS protects the header, image controls, inspection toolbar,
dialogs and divider handle. The image stage has no blanket left/right cutout
gutter. Images use the enlarged viewport if supplied, including space beside or
behind the cutout, while controls stay inside reported safe bounds. No notch size
or system-bar height is guessed. If a browser reports incorrect insets or keeps
letterboxing its window, application CSS cannot reliably correct that policy.

The same viewer/layers, original object URLs and configuration remain mounted.
Existing geometry remeasurement and gesture cancellation handle viewport changes;
zoom, source center, selected images, metadata and divider position are retained.
Minimalist and full-controls presentation share one fullscreen session, so changing
between them does not race a second native request. A request completing after
portrait/cancellation is exited instead of reopening immersive mode.

The Android APK uses its existing native adapter. No native window/inset policy,
manifest, orientation handling or original-image storage changes. PWA registration,
cache privacy, waiting updates, sharing policy and deployment/audit guards are
unchanged.

## Automated and physical verification

`tests/pwa/landscape-fullscreen.spec.ts` covers full controls in both layouts,
unchanged layers/source state/pixel scaling, both simulated cutout sides, portrait
and tab/desktop isolation, user activation, denial/missing/partial/disabled APIs,
delayed cancellation, session transfer, system/rejected exits and touch pan/pinch.
It also attempts the real Chromium/Firefox API and records grant or explicit denial.
Installed-window/inset models do not simulate Android's native window flags.
Existing PWA, minimalist, pixel, gesture, offline/update and Android suites remain
enabled. CI includes Firefox; desktop Firefox is not Android GeckoView.

Physical Android acceptance remains required on **both Chrome and Firefox**:

1. Record phone, Android/browser versions, app version and navigation mode. Finish
   any active comparison before updating; no public deployment is run by this PR.
2. Launch from the installed icon in portrait, then directly in landscape. Confirm
   the normal UI and no unsolicited fullscreen request or dialog.
3. In both landscape rotations, choose **Fullscreen with controls**. Check the
   status/navigation bars and actual cutout-side area; record whether the browser
   grants more space. All controls, dialogs and the divider handle must remain
   accessible on either cutout side.
4. Test Split Screen / Side-by-Side, image replacement/selection/labels, metadata,
   Fit and pixel zoom, real pan/pinch and divider drag. Original files and image
   geometry must remain intact.
5. Open/close the keyboard, file picker and Help; test Android Back, system exit,
   sleep/resume and portrait rotation. Portrait should return to normal window
   behavior when the browser permits exit; landscape must not re-enter by itself.
6. Repeat minimalist entry/exit in both orientations and offline. Confirm ordinary
   browser tabs and the separate Android APK retain their existing behavior and
   **Share Comparison** remains disabled in the public demo.

If the browser still reserves the cutout region after granting fullscreen, record
the device evidence as a browser/Android limitation. Do not silently switch the
manifest to fullscreen or hide essential controls as a workaround.
