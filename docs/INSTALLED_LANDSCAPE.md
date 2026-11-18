# Installed PWA fullscreen experiment

## Launch mode and platform boundaries

The web manifest requests `display: fullscreen`, in both portrait and landscape.
This is an installed-window preference, not a JavaScript fullscreen request and
not a separate interface. Browsers choose the actual supported display mode.
The ordinary website and Android APK retain their existing interface and behavior.
No native Android window policy, orientation lock or original-image handling changes.

The manifest keeps its explicit `id` and `scope` at Vite's resolved base (`/` or
`/upscale-compare/`). Its `start_url` adds the fixed `?pwa=fullscreen` launch hint.
Icons, names, manifest location and app identity are otherwise unchanged. The hint
contains no image data and is not an installation, authentication or storage credential.

Manifest fullscreen is independent of `document.fullscreenElement`, which may be
null even in a genuinely fullscreen installed window. Conversely, a browser tab
using the Fullscreen API also matches `display-mode: fullscreen`. The app therefore
requires **the launch hint, fullscreen media at document startup, no API fullscreen
element and no browser-mode match** before enabling its installed-fullscreen class.
It does not promote an already-open tab when API fullscreen or F11 is entered later.
Unmarked canonical website URLs keep tab behavior even if opened in an F11 window.
Existing/fallback standalone windows keep PR #30's context handling.

There is no universal web API proving that a particular window is installed.
Deliberately opening the marked installer URL in a browser window already in F11
at page load is indistinguishable from the same reported native app-window state.
Do not distribute that URL as the regular website link. A deep link without the hint
or a browser with inconsistent display-mode reporting conservatively keeps the
ordinary/legacy controls. No security, sharing or storage permission depends on this hint.

## Controls and desktop implications

An identified fullscreen launch starts with all existing controls visible, without
a tap or automatic Fullscreen API call. The existing toolbar action is now
**Minimalist mode**, and its return action is **Show controls**. There is no redundant
"enter fullscreen" or "exit fullscreen" option for a window already launched that way.

Minimalist presentation is independent of the manifest window mode. Its existing
explicit user action can use the Fullscreen API for browser/system exit handling;
if unavailable, the CSS presentation still works. Showing controls exits only the
app-owned API element and returns to the underlying manifest window. Rotation does
not request fullscreen or discard the comparison. Without API support, Android
Back may close the window instead of leaving CSS-only minimalist mode; use Show
controls to return. This remains a physical-device/browser check.

Older or fallback standalone installs retain PR #30's landscape **Fullscreen
options**, including Fullscreen with controls. Ordinary browser tabs retain their
original fullscreen/minimalist button in all orientations and pointer modes.

One manifest cannot make this launch preference exclusive to Android. Desktop
installed PWAs may also launch fullscreen if supported, or fall back to standalone.
The app does not force an unsupported desktop mode through JavaScript. When native
fullscreen is reported with the launch hint, the same safe controls and minimalist
action apply to mouse-first installed windows. Desktop OS window management and
manifest preference updates remain browser-controlled.

## Safe areas and local data

`viewport-fit=cover` remains set. Android/browser window policy ultimately decides
whether cutout or system-bar areas are available. Manifest fullscreen alone is not
proof that a particular device grants cutout coverage.

Installed-only CSS uses `env(safe-area-inset-*)` through the existing viewport
adapter. Header/title, upload, image controls, toolbar, dialogs, notices and divider
handle stay inside reported safe bounds. Horizontal control gutters use the larger
side inset symmetrically, so left/right cutout rotations preserve alignment. Portrait
reserves top/bottom insets; visual-viewport measurements also constrain keyboard
dialogs. The image stage does not receive those horizontal gutters, and backgrounds
and images can use the exposed cutout area. Only the divider handle moves inward;
the divider line and source-pixel geometry remain unchanged.

No camera dimensions or bar heights are guessed. Zero insets can mean no obstruction
or missing browser information; there is no reliable general way to distinguish them.
If the browser grants drawing behind a cutout but omits its insets, safe controls
cannot be guaranteed by web CSS. Record that limitation and stop device acceptance
rather than hardcoding offsets or forcing a different website/native window policy.

The launch query is already accepted by the existing app-shell navigation fallback.
It does not add a cache, runtime route or comparison persistence. Original PNG/JPEG/
WebP files and metadata remain in memory; reopening starts an empty comparison.
Service-worker waiting updates, scope, precache integrity and privacy are unchanged.
Public Share Comparison, Cloudflare production and dependency/deployment gates stay
under their existing restrictions.

## Fresh-install test

This PR does not publish anything. Run these steps only against a separately
approved deployment of the exact reviewed commit.

1. Finish the comparison and retain any needed labels separately. Record device,
   Android/browser versions, navigation mode and existing Help version. Close all
   app windows and tabs for this site. Do not uninstall the native APK or browser.
2. Visit the canonical HTTPS site online, allow resources to download, then close
   all its tabs/windows and reopen until Help shows the new commit and offline
   readiness. This preserves the normal waiting-worker lifecycle; no forced reload
   or skipWaiting shortcut is needed.
3. Inspect `/upscale-compare/manifest.webmanifest`: `display` must be `fullscreen`,
   `id`/`scope` must remain `/upscale-compare/`, and `start_url` must be
   `/upscale-compare/?pwa=fullscreen`. Close the manifest tab afterward. A fresh HTML
   version does not prove installed Android metadata has updated.
4. For a deterministic experiment, remove the old **PWA/shortcut only** from its
   launcher/App info. Leave any "also clear website/browser data" option unchecked;
   do not clear all origin storage, caches or publication/deletion keys. Removing
   a PWA does not delete your source screenshots on the device.
   In Chrome, uninstall its WebAPK from the PWA's App info. In Firefox, remove its
   launcher shortcut and add it again; if App info identifies Firefox itself, do
   not uninstall the browser. A newly added shortcut that still reports standalone
   is a fallback to record, not a reason to erase browser data.
5. Reopen the canonical site in normal Chrome or Firefox and install from its menu.
   Confirm an app installation rather than an ordinary bookmark shortcut. Launch
   from the new icon, not from the canonical or copied launch URL in a browser tab.
6. Launch first in portrait, then cold-launch in each landscape rotation. Before
   touching any fullscreen control, verify the complete UI, actual status/navigation
   bars and cutout-side coverage. Check title/mark, uploads, image selectors/labels,
   zoom toolbar, edge divider handle and every dialog against both cutout sides.
7. Test both layouts, exact pixel zoom, Fit, pan/pinch, replacement and picker cancel.
   Switch to Minimalist mode and Show controls, rotate, use Android Back, open/close
   the keyboard and dialogs, and sleep/resume. No comparison should reload or lose
   source state during these transitions.
8. Wait for offline readiness, close all windows/tabs, enable airplane mode and
   launch from the icon. Confirm full UI without a fullscreen tap, empty previous
   session and fresh local PNG/JPEG/WebP import. Verify ordinary browser tabs,
   including their own fullscreen action, and the separate native APK are unchanged.

Chrome can update WebAPK manifest metadata separately from cached app assets,
potentially after all windows close and Android update conditions are met. Firefox
and desktop browser behavior differs. Do not assume a refresh or a service-worker
update immediately changes an installed display preference. Fresh installation is
the test baseline; reinstall also provides a clear rollback to an approved manifest.
The explicit manifest ID preserves identity in browsers that implement it; older
implementations may use the start URL, which is another reason to remove the old
shortcut/app rather than leave duplicate installations during this experiment.

## Evidence and references

Automated tests model fullscreen/standalone/tab contexts and reported insets in
Chromium, Firefox and WebKit. They cover API/F11 isolation, both cutout sides,
portrait, controls/dialogs, minimalist/system-exit transitions, keyboard and offline
launch URLs alongside the existing geometry/gesture/update/privacy suites. The real
Linux Chromium installation test records the browser's actual mode/fallback and
reopens the same installed profile offline; it does not emulate fullscreen media.
None of these certifies Android WebAPK/GeckoView, physical cutouts or OEM behavior.
**Phone acceptance remains required on Chrome and Firefox.**

References reviewed on 2026-11-18:
[manifest display modes](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display),
[manifest identity](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id),
[Chrome manifest updates](https://web.dev/articles/manifest-updates),
[Chromium cutout/inset implementation](https://chromium.googlesource.com/chromium/src/+/main/docs/ui/android/display_cutout.md)
and [reported fullscreen-PWA edge-to-edge issues](https://issues.chromium.org/issues/407420295).
