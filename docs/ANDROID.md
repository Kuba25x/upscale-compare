# Android offline app

Status: debug implementation; Xiaomi 15T / Android 16 device qualification is pending.
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
Only the selected pair is rendered; the upload dialog does not decode full-size
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

Cloud-only files are not available offline. Providers must return the actual
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
- **Clear comparison** in the existing upload dialog commits an empty session and
  removes the unreferenced private originals. Cleanup failures are reported; any
  leftovers still count against the storage quota and are retried on startup/save.
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

The separate **Android debug APK** workflow runs on relevant PR/branch changes
and workflow_dispatch. It has read-only repository permission, no backend secrets
and no deployment steps. Open the successful run, download
`upscale-compare-debug-<commit>`, unzip it and install `upscale-compare-debug.apk`.
The artifact includes SHA256SUMS and COMMIT and is retained for 14 days.

CI uses a disposable debug signing key. Builds from different runners may not
update an existing installation: uninstall first, which deletes its private
comparison, or use local builds signed by the same local debug key. Stable CI
signing is deliberately not simulated with a committed private key; configure a
protected test signing secret in a future trusted release workflow if needed.
These APKs are test builds, not Play Store releases. Distribution must include
corresponding source under AGPL-3.0; Android/MIT notices are bundled in the assets.

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

## Recorded implementation checks — 2026-11-04

On the implementation branch, `npm run build`, all **305** Vitest unit/integration
checks, **31** demo, **45** E2E, **37** local production-sharing and **5** diagnostics
browser checks passed. The focused Android/guard subset passed **9** checks;
these are already included in the Vitest total. `npm audit --audit-level=high`
reported zero vulnerabilities. Formatting and diff whitespace checks passed.

The Android-mode browser suite passed both real synthetic 4K/8K image cases with
a mocked native bridge. It checks decoded pixel samples, pinch, session restore,
clear/cancel and fullscreen/back routing. The initial local signed APK build
passed lint/JVM tests; the final branch is also built and signed independently
in the Android debug APK workflow, including **7** native policy JVM tests.
Consult the PR checks/artifact for the exact final CI commit and outcome.

No physical Xiaomi measurements or native picker/lifecycle test results are
claimed. These remain the release-qualification gate described above.

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
Real Android 16 insets, system-bar visibility and physical touch behavior still
require verification on Xiaomi 15T; no hardware results are claimed here.

## System Photo Picker and Files fallback

The default Photos source uses AndroidX Activity 1.11.0 `PickMultipleVisualMedia`
for two or more available slots and `PickVisualMedia` for a single replacement or
last remaining slot. A new/replaced comparison requires two to four items; adding
allows one through the remaining slot count. The system picker provides its normal
tap selection and confirmation UI. Its API sets a maximum, not a minimum: choosing
only one image for a new comparison is rejected after confirmation, before native
streams are opened or large originals are copied. Empty/cancelled results do nothing.

**Browse files instead** on the landing screen and the **Image source** selector
in the existing upload dialog preserve access to PNG/JPEG/WebP documents outside
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

Implementation checks: 22 JVM/Robolectric tests, 309 frontend/backend unit and
integration tests, 9 Android browser tests, 32 demo tests and 45 E2E tests passed
locally. Android lint, debug APK assembly, type checking and formatting passed.
The CI build/artifact for the exact PR head is linked in PR #20.

## Edge-to-edge display and compact landscape interface

`feat/android-edge-to-edge` starts from merged PR #20 at main `dddd663`.
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

The tiny `DisplayLayout` plugin exposes getState, setMode and layoutChange. All window
mutations run on the activity UI thread. It reports physical-pixel bar, cutout and
gesture measurements and actual cutout rectangles; React converts them using the
WebView's devicePixelRatio. Only controls use cutout/gesture padding in landscape.
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
