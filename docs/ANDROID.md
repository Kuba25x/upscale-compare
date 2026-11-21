# Android offline app

Status: implemented offline preview with automated browser/JVM/API 36 instrumentation
coverage. [v0.1.0-android-preview.1](https://github.com/Kuba25x/upscale-compare/releases/tag/v0.1.0-android-preview.1)
is publicly available as a debug APK. See [installation](../README.md#download-and-install-android)
for the user guide. Xiaomi 15T / Android 16 physical-device qualification is pending.
The 256 MiB file ceiling is provisional, not a guarantee that WebView can decode
or display every accepted file. Do not describe this build as device-certified.

## Architecture

The `android` Vite mode packages React assets in `dist-android`, then Capacitor
8.6.0 copies them into the APK. There is no remote server URL, Cloudflare client,
Turnstile request or hosting dependency in the offline flow. Share Comparison
stays disabled even if production environment variables are present. The web/demo
builds, publication limits and backend deployment controls retain their behavior.

The shared Viewer and geometry retain the existing two modes, contact snapshots,
synchronized panning, source coordinates and physical-pixel zoom. The Android
adapter replaces browser File ownership with private native original identifiers.
Only the selected pair is rendered; Manage Images does not decode full-size
thumbnails of every stored original. No new comparison renderer is introduced.
The existing favicon design is reused for the launcher and splash screen.

`OriginalsPlugin` defaults to the AndroidX Photo Picker contracts for images.
Files remains an explicit SAF alternative with ACTION_OPEN_DOCUMENT, CATEGORY_OPENABLE
and EXTRA_LOCAL_ONLY. Selection grants cover only chosen items; broad photo-library
or storage permissions are not requested.
The provider's source stream is copied once in 64 KiB chunks, hashed with SHA-256,
and fsynced. No Base64, full-file JS buffer, image re-encoding or resizing is used.
Metadata and bounds are checked both before copying and on the private copy;
WebView performs the actual image decode. A header check is not full codec validation.
EXIF display orientation is accounted for without rewriting original bytes.

Cloud-backed files become available offline only after their original stream has
been copied successfully into private storage. Providers must return the actual
original document stream; the app preserves that stream, not a provider-generated
thumbnail. Provider metadata and declared file size are not trusted as quotas.

## Storage and lifecycle

- Provisional original limit: 256 MiB; 36 million pixels; 16,384 pixels per side.
- Two to four originals; at most 1 GiB in the committed comparison.
- At most 2 GiB of originals including a replacement in progress, with a 256 MiB
  free-space reserve checked while copying. Other apps can still consume storage;
  write failures abort import safely.
- Files and the AtomicFile session journal live in no-backup private app storage.
  Android app backup is disabled. Uninstall / clearing app data removes originals.
- A single native I/O executor serializes mutations. Imported files are pending
  until a validated session journal is committed. Cleanup keeps both committed
  originals and pending imports, and never deletes provider-owned source files.
- Failed batches discard their private partial copies. Startup removes unreferenced
  files only after reading and validating the journal. A corrupt/unreadable journal
  fails closed: it does not authorize deleting stored originals. Recovery from that
  condition currently requires clearing Android app data or repairing the journal.
- Saving the current session is debounced by 250 ms and flushed on app background.
  Abrupt process termination can lose the most recent gesture or pending import;
  the last committed session survives. Interrupted restored picker results are
  discarded explicitly and the user is asked to choose the files again.
- Removing an image commits the updated comparison and releases its private copy.
  If one image remains, Android commits an empty session and retains the surviving
  original in memory as a draft reference while **Manage Images** is open. Add an
  image to commit a new pair, or close the dialog to release the draft and return
  to the landing screen. Restarting the app clears an unfinished draft.
- **Clear comparison** commits an empty session and removes the unreferenced
  private originals. The dialog stays open for new imports. Cleanup failures are
  reported and retried on startup or save.
- Calls arriving from a destroyed Activity are rejected before scheduling storage
  work, including a delayed save or picker result. They cannot write/clean originals
  through a stopped executor; the recreated Activity restores the committed journal.
- Back closes an open dialog (busy import prevents dismissal), then leaves comparison-only
  fullscreen or closes the expanded landscape image panel. Root back remains under
  Android's predictive-back navigation. AndroidDisplayLayout owns native bar visibility,
  cutout and gesture insets; the web keeps its HTML fullscreen implementation.

No `largeHeap` override is used. WebView owns decode and texture caches; removing
an image element cannot force immediate cache eviction. A pair of 8K RGBA8 images
alone needs about 253 MiB before decoder/GPU overhead. Decode/render errors are
reported without silently reducing quality. Renderer-process death remains a
physical-device test case, not something browser tests can certify.

## Reproducible toolchain and build

Use Node 24.19.0, npm 11.9.0, JDK **21 with javac**, Android platform 36 and SDK
Build Tools 35.0.0. Capacitor core/android/cli are exactly 8.6.0; App is 8.1.2.
AGP is 8.13.0; the committed wrapper uses Gradle 8.14.3 with a distribution SHA-256.
Android Studio 2025.2.1 or a version supporting this AGP can open `android/`.
The application id is `io.github.kuba25x.upscalecompare`; minimum API is 24,
compile/target API is 36. Older devices are not yet qualified.

```sh
npm ci
sdkmanager 'platforms;android-36' 'build-tools;35.0.0' 'platform-tools'
npm run android:apk
```

Set JAVA_HOME and ANDROID_HOME to your JDK and Android SDK first. Review/accept
SDK licenses through sdkmanager. The script builds frontend assets and licenses,
synchronizes Capacitor, runs Android lint/JVM tests, and assembles a signed debug
APK at `android/app/build/outputs/apk/debug/app-debug.apk`.

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Do not commit SDK installations, local.properties, generated web assets, APKs or
keystores. Initial dependency installation needs network access; the installed
application does not. The committed package lock and wrapper pin the main build
inputs; this is not a promise of byte-identical APKs across JDK patches, OS images,
repository metadata or signing keys.

## GitHub Actions and APK downloads

[The public Android Preview](https://github.com/Kuba25x/upscale-compare/releases/tag/v0.1.0-android-preview.1)
provides the debug APK, SHA256SUMS, COMMIT, corresponding source and dependency
notices. Users can install it directly without GitHub Actions or build tools.
Maintainers can follow the [Android Preview publishing guide](ANDROID_PREVIEW.md)
to build and approve a new debug pre-release from `main`.

The separate **Android debug APK** workflow runs on relevant PR/branch changes
and workflow_dispatch. It has read-only repository permission, no backend secrets
and no deployment steps. Open the successful run, download
`upscale-compare-debug-<commit>`, unzip it and install `upscale-compare-debug.apk`.
The artifact includes SHA256SUMS and COMMIT and is retained for 14 days.

CI uses a disposable debug signing key. Builds from different runners may not
update an existing installation: uninstall first, which deletes its private
comparison, or use local builds signed by the same local debug key. Production signing is deliberately separate: the release preparation workflow
builds an unsigned, non-debuggable APK; the owner signs it offline using a stable
private key on a trusted computer. No production key or signing secret goes to CI.
These APKs are test builds, not Play Store releases. Distribution must include
corresponding source under AGPL-3.0; MIT, ISC, 0BSD and Apache-2.0 dependency notices are bundled in the assets.

## Automated checks

```sh
npm run build
npm test
npm run test:demo
npm run test:e2e
npm run test:sharing:local
npm run test:diagnostics
npm run test:android:web
npm run android:apk
```

The Android browser suite uses a **mock native bridge** and actual synthetic 4K/8K
PNGs. It checks offline requests, native-adapter routing, decoded pixels, physical-pixel scale, Chromium pinch, restore, cancel, clear and
fullscreen/back adapter routing. It does not measure Android memory, exercise SAF or certify
phone performance. Native JVM tests cover streaming byte/hash identity, exact
256 MiB input without a full-size allocation, unknown-length overflows, free-space
refusal, empty inputs and dimension limits. Existing web suites retain gesture,
pixel and backend-security regression coverage.

## Required Xiaomi 15T / Android 16 qualification

Record APK commit/hash, HyperOS build, WebView version, screen density/resolution,
refresh setting and free storage. Install the APK and disable connectivity before
its first launch. Use synthetic PNG/JPEG/WebP originals, including high-entropy
files above 20 MiB, mixed sizes, transparency, EXIF rotation and 16-bit PNG.
Compare source SHA-256 against the journal/copy in a debuggable installation.
Original-byte preservation does not certify HDR, 16-bit display precision or
cross-device colorimetric equivalence.

Test two and four 4K/8K files, twenty replace/switch cycles, both comparison modes,
Fit/100/200/400%, pinch across the divider, contact cancellation, background/return,
rotation, keyboard and gesture/three-button Back. Test picker cancellation,
unavailable documents, full storage, clear comparison, process death during picker,
copy and save, and restart after cleanup failure. Check that originals belonging to
the provider never change. A failed decode must report an error without recompression.
On a physical phone, confirm that the portrait header fits within the reported
cutout and gesture insets at the smallest available display size. Open the
onscreen keyboard from **Manage Images**, edit labels, rotate and reopen, and
verify **Help & About** and Android Back in both orientations. Check external
keyboard shortcuts and repeat the portrait and landscape checks in Chrome's
installed PWA.

Collect Android Studio memory/CPU traces, `adb shell dumpsys meminfo` for the app
and associated WebView renderer, graphics allocations, frame times and logcat
OOM/ANR/renderer exits. JS heap alone is insufficient. Accept only if imports and
repeated comparisons complete without crashes, memory does not grow across cycles,
and gestures remain usable. Quantify latency and frame-time percentiles on the
actual device before setting final performance thresholds.

If full-image rendering cannot meet these criteria, stop and report the failing
fixtures, memory/frame measurements and a region/tile-renderer recommendation.
Do not introduce that larger renderer change without owner approval. No renderer
qualification or physical-device results are claimed by this implementation.

## Current verification evidence

Historical implementation snapshots are not a qualification of a later APK.
Use the checks and artifacts attached to the exact release-preparation PR commit.
Current results are recorded in [ANDROID_RELEASE_VALIDATION.md](ANDROID_RELEASE_VALIDATION.md).

| Layer                                          | What it establishes                                                                                | What it does not establish                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Frontend/backend unit and browser suites       | Shared geometry, pixels, offline adapter, gestures, web/sharing regressions                        | Android window manager or real device memory                                   |
| JVM/Robolectric tests                          | Streaming hashes/limits, URI contracts, cancellation, rollback and lifecycle protocol              | OEM Photo Picker UI or Chromium renderer behavior                              |
| API 36 emulator instrumentation                | Native insets, cutout policy, bars/icons, transitions, Back, picker return and Activity recreation | HyperOS-specific behavior or sustained 8K performance on Xiaomi                |
| Release preparation and disposable-key signing | Non-debuggable APK, package/version, alignment, source provenance, certificate/hash checks         | Production key custody, signed-release device acceptance or public publication |
| Physical Xiaomi 15T / Android 16               | Qualification checklist below, still pending                                                       | No measurements are inferred from browser/emulator tests                       |

No physical-device performance, memory, HDR/color precision or OEM system-UI
certification is claimed. Automatic results must be tied to a successful run and
exact source SHA; compilation alone is not an instrumentation pass.

## Future owner-signed release preparation

The next Android Preview candidate uses 0.1.0-android-preview.2 (versionCode 3),
declared in [android/release.properties](../android/release.properties).
The published debug preview uses 0.1.0-android-preview.1 (versionCode 2).
A separate read-only release workflow produces an unsigned candidate, source/dependency
archive, notices, manifest and SHA-256 checksums. It neither tags nor publishes.
The owner must generate/retain the permanent key on a trusted computer, sign
offline, verify the public certificate and qualify the signed build.

Native Windows 11 signing is documented in
[the PowerShell guide](ANDROID_WINDOWS_SIGNING.md); WSL2 is optional.
Follow [the owner release runbook](ANDROID_RELEASE.md) for exact commands, source
distribution obligations, update testing and the manual publication gate. This
owner-signing process is separate from the already published debug preview.

## Android comparison-only fullscreen — 2026-11-07

The Android toolbar keeps its existing fullscreen icon as the last button. It
activates an app-scoped layout class, never HTML fullscreen. The native display
controller applies the orientation/mode policy described below.
Only the existing image layers, Split Screen divider/handle and a standalone
48-by-48 CSS-pixel exit target remain visible. The exit button has a translucent
dark background and a 12-pixel minimum inset from the viewport edges, respecting
safe-area insets. It is absent from the normal interface. Taps never reveal UI.

The same Viewer and image elements stay mounted. Entering/exiting does not change
selected sources, mode, divider, zoom or source center. Android layout transitions
are measured before painting; ResizeObserver adapts Fit and display density, and
cancels stale touch contacts when the viewport changes. Source bytes, dimensions
and the physical-pixel zoom model are unchanged. A system Back action exits this
layout before root navigation; ordinary modal Back behavior remains available.

Fullscreen browser tests cover both comparison modes, mixed dimensions, exact
state preservation, pan/pinch, divider movement, portrait/landscape and short
viewports, button placement/visibility, unchanged image nodes/URLs/load counts,
display-policy adapter calls and Back/modal routing. Native bridge calls are
mocked. Desktop/mobile web tests cover the unchanged HTML fullscreen behavior.
API 36 instrumentation exercises native insets/system bars separately. Xiaomi 15T
still requires OEM insets, physical touch and memory qualification; no phone
measurements are claimed here.

## System Photo Picker and Files fallback

The default Photos source uses AndroidX Activity 1.11.0 `PickMultipleVisualMedia`
for two or more available slots and `PickVisualMedia` for a single replacement or
last remaining slot. A new/replaced comparison requires two to four items; adding
allows one through the remaining slot count. The system picker provides its normal
tap selection and confirmation UI. Its API sets a maximum, not a minimum: choosing
only one image for a new comparison is rejected after confirmation, before native
streams are opened or large originals are copied. Empty/cancelled results do nothing.

**Browse files instead** on the landing screen and the **Image source** selector
in **Manage Images** preserve access to PNG/JPEG/WebP documents outside
the indexed media library. AndroidX automatically falls back to SAF when no Photo
Picker implementation is available; a missing picker activity also falls back to
SAF. The fallback has no enforceable system selection maximum, so native validation
checks the actual deduplicated URI list before storage work. Unsupported codecs
and non-content URIs are rejected; app limits remain unchanged.

Photo Picker cloud-provider images may require network access during import. They
are available to the app offline only after the native copy succeeds. The app
never asks for thumbnails, transcodes or transfers originals through JavaScript.
The existing ContentResolver stream, hash, bounds/format checks, private storage
and atomic commit/cleanup pipeline are retained. A failed batch retains the last
committed session and removes private partial copies.

### Capacitor lifecycle integration

Contracts create the launch Intent and parse returned URIs. The launch still uses
Capacitor's pre-registered `startActivityForResult(..., "picked")` and
`@ActivityCallback`, which saves the original PluginCall and its minimum/limit/source
options. No late ActivityResultLauncher registration or separate Activity is added.
After process recreation, a dangling Capacitor call has no live JavaScript consumer:
its result returns an interrupted marker without downloading/copying selected cloud
items, and the existing `appRestoredResult` handler requests a fresh selection while
restoring the committed session. No persistent library permission is needed for
completed private copies.

Native tests include AndroidX contract/URI/fallback checks on simulated API 28/33,
Capacitor launch/call persistence, cancellation and interrupted results, and actual
ContentResolver copies with synthetic PNG/GIF fixtures, byte/hash verification and
failed-batch rollback. Robolectric is a test-only dependency. Its Bridge test uses
a WebView without ServiceWorkerController interception because no real Chromium
provider runs inside Robolectric; native activity-result and call restoration code
is exercised. Browser tests mock the bridge to verify source selection, slot bounds
and preservation of the current comparison. Existing large-stream tests remain.

On Xiaomi 15T / Android 16 verify actual tap/confirm UX, single replacement,
remaining slots, Files access, cancel/back, cloud items online/offline and activity
recreation during the picker/copy. Automated framework tests do not certify the OEM
picker UI or real-device performance.

References: [Android Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker),
[Capacitor Android plugins](https://capacitorjs.com/docs/plugins/android).

The current native/frontend regression suites run in CI; consult the exact source
commit's checks and the current verification record rather than historical PR #20
counts. Device acceptance remains a separate step.

## Edge-to-edge display and compact landscape interface

The merged Android implementation includes edge-to-edge and compact landscape UI.
`AndroidDisplayLayout` owns the window with AndroidX `WindowCompat`,
`WindowInsetsControllerCompat` and measured `WindowInsetsCompat`. Capacitor's built-in
SystemBars inset handling is disabled to avoid competing decor padding; its initial
style is DARK (light icons). The window and app background are #101114, system bars
are transparent, and contrast scrims are disabled. The Android build alone adds
`viewport-fit=cover`. No device model, fixed notch offset or legacy system-UI flags
are used.

| Orientation                 | App mode   | Status bar | Navigation bar | Image surface                                                |
| --------------------------- | ---------- | ---------- | -------------- | ------------------------------------------------------------ |
| Portrait                    | Normal     | Visible    | Visible        | Below status/camera safe area and above navigation           |
| Portrait                    | Minimalist | Hidden     | Visible        | Physical top edge, including camera cutout; above navigation |
| Landscape, either direction | Normal     | Hidden     | Hidden         | Full width including camera cutout; below compact header     |
| Landscape, either direction | Minimalist | Hidden     | Hidden         | Full window including camera cutout                          |

Hidden bars support transient reveal by system edge swipe. Transient visibility does
not add reserved image padding. The normal portrait layout is retained. In landscape,
the normal header is a single 52 CSS-pixel row (plus any measured top cutout safety),
with identity, comparison mode, Images and import. On narrower windows the mode/import
controls retain accessible names and use icons. Images opens the existing A/B selection,
swap and label controls as a temporary panel. Inspection tools remain at the bottom
edge with a touch-friendly zoom selector. Rotation never activates minimalist mode.
The hidden status bar's mandatory swipe-start region is not reserved as header
padding. Tap controls leave system edge swipes available; cutout and side/bottom
gesture insets still protect the controls.

The tiny `DisplayLayout` plugin exposes getState, setMode and layoutChange. All window
mutations run on the activity UI thread. It reports physical-pixel bar, cutout and
gesture measurements and actual cutout rectangles; React converts them using the
WebView's devicePixelRatio. Insets are observed at the window decor root before child
views can transform or consume them. Only controls use cutout/gesture padding in landscape.
The divider line remains aligned to the comparison; its handle can shift away from
an unsafe edge. Dragging that handle retains its initial grab offset, and viewport
changes cancel its capture so stale coordinates cannot move the comparison.
The minimalist exit button stays above gesture/navigation space.
Dialogs respect asymmetric insets and the keyboard. Image layers remain mounted;
the existing ResizeObserver/geometry adapts Fit without rewriting zoom or source center.

Native policy is reapplied on orientation change, resume, regained window focus and
page commit, including returns from Photo Picker. Minimalist state is saved in the
Activity bundle and restored before React initializes, without clearing the committed
comparison while session restoration is pending. No import, original-byte, quota,
sharing or backend behavior changes.

### Native system UI instrumentation

The Android workflow also runs an API 36 emulator with gesture navigation and a
simulated display cutout. Instrumentation checks actual WindowInsets visibility,
light icon appearance, cutout layout, DOM safe targets, both landscape directions,
Photo Picker cancellation/return, background/resume, Back and Activity recreation.
Screenshots and connected test reports are uploaded separately. Browser tests cover
layout/state/zoom, touch gestures and retained image elements; they are not evidence
of native window-manager behavior.
Transient reveal is checked against native WindowManager policy: Android deliberately
keeps transient visibility out of app insets so overlay bars do not resize content.
Background pixel checks wait for compositor presentation after insets delivery.
Screenshots also wait for WebView's visual-state callback and animation frames;
fixture-background and transient-icon pixel checks reject captures of the previous mode.
The test recognizes Android's first-use immersive tutorial window and confirms it
with the system top-edge swipe described by that tutorial. Pixel assertions inspect the same native PNG that
is uploaded, and failure reports retain the frame plus DOM/native scroll coordinates.

The test build is isolated as `io.github.kuba25x.upscalecompare.systemuitest`; it seeds
only its own synthetic comparison. It cannot overwrite an installed user's normal
app data. With a connected API 36 emulator configured for a cutout and gesture navigation:

```sh
npm run android:sync
adb shell cmd overlay enable --user 0 com.android.internal.display.cutout.emulation.tall
adb shell cmd overlay enable --user 0 com.android.internal.systemui.navbar.gestural
cd android
./gradlew connectedSystemUiAndroidTest
```

The normal debug APK is still built with `npm run android:apk`. Test reports and APKs
remain separate artifacts. Confirm the workflow outcome for the exact PR commit;
compiled instrumentation or Robolectric tests alone do not establish a device pass.

Xiaomi 15T / Android 16 still requires physical-device qualification: HyperOS bar
colors/icon contrast, actual camera bounds in both rotations, transient edge swipes,
keyboard/three-button navigation, predictive Back and sustained 4K/8K touch performance.
The emulator does not certify OEM behavior or real-device memory stability.
