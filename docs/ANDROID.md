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

`OriginalsPlugin` uses ACTION_OPEN_DOCUMENT, CATEGORY_OPENABLE and EXTRA_LOCAL_ONLY.
It requests access only to selected documents, without broad storage permissions.
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
- Back closes an open dialog (busy import prevents dismissal). Root back remains
  under Android's predictive-back navigation. Capacitor SystemBars handles insets.

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
PNGs. It checks offline requests, native-adapter routing, pixel scale, restore,
cancel and clear. It does not measure Android memory, exercise SAF or certify
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
