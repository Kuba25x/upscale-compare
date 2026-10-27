# Local gesture diagnostics

The initial candidate failed the reporter's actual-device retest, so this optional tool collected four Firefox/Chrome logs. Their analysis led to the complete-touch-snapshot fix, now confirmed by the reporter on Xiaomi 15T / Android 16 / Firefox 158.0.2 in both modes; Chrome remains correct. See [analysis and device acceptance](PINCH_LOG_ANALYSIS.md). Retain this development-only tool for future investigations. It is inactive in production builds.

## Enable and collect

Use branch `fix/stable-pinch-gestures` (PR #9):

```bash
git switch fix/stable-pinch-gestures
git pull --ff-only
npm ci
npm run dev:demo
```

On the phone, open the same computer LAN address used for the local demo, adding `?diagnostics=1`:

```text
http://<computer-LAN-IP>:5173/upscale-compare/?diagnostics=1
```

The flag works only in a Vite development server with demo mode enabled. It is disabled by default and cannot be enabled in production builds, including the built Pages demo. No backend, ADB or remote debugging setup is needed.

1. Load the same two images in Firefox and Chrome. Select Split Screen and Fit before recording.
2. Tap **Diagnostics**, then **Start recording**. The dialog closes so it does not obstruct the gesture or change viewer layout while recording.
3. Record about 15–20 seconds: slow expansion/contraction, quick repeated gestures, lift either finger and add it again. Include a visible jump if one occurs.
4. Lift both fingers, tap **Stop diagnostic log**, then **Download log**. The JSON appears in browser downloads. Filenames include browser family and starting mode, such as `upscale-compare-firefox-split-gestures.json`.
5. Repeat separately for Side-by-Side, then collect the same two logs in Chrome on the same phone. Use the same screenshots and starting Fit view.
6. Attach the four JSON files to the existing conversation and indicate whether/when a jump occurred. Nothing is uploaded automatically.

**Copy log** first tries the browser Clipboard API. Local HTTP may lack that API; a selectable read-only text area is then opened, with **Select all log text** and the phone's ordinary Copy action. Download is the preferred fallback if copying is inconvenient. **Clear log** removes the in-memory recording. Refreshing the page also clears it; removing the query flag disables diagnostics.

## Recorded data

The versioned `upscale-compare-gesture-log` JSON contains:

- Browser family/version only, relative recording time, and native event timestamps. No full user-agent string, current URL, hostname or absolute wall clock is collected.
- Native Pointer Events, pointer IDs/types/primary status, coordinates/buttons/pressure, bounded coalesced positions, and stage/divider pointer-capture status. Capture acquisition/loss and contacts outside the viewer are included to identify event retargeting. Unpressed mouse hover outside the viewer is ignored.
- Touch Events and their touches/changedTouches/targetTouches identifiers and client/page coordinates. The application pointer cache and its distance are recorded independently of native touches.
- Wheel deltas/mode/modifier state and double-click events, plus whether the existing handlers ignored them.
- Window/visibility and visual viewport resize/scroll, scale, dimensions, offsets and DPR.
- Pinch/pan/wheel calculations: source event ID, previous/next view, cached contact coordinates/IDs, old/current distance, ratio, midpoint, panel offset, requested zoom and applied zoom. The original calculation is evaluated once per updater invocation; tracing records its result without adding another calculation or update.
- Committed view center/zoom, scale, stage/panel/image dimensions, divider position and inline rendered image size/transform/pixel-rendering styles. These are geometry only: no image pixels, files, image URLs, filenames, labels, game/hardware fields or other comparison metadata are read into the log.

Calculation entries are **evaluations, not commits**. React development StrictMode can evaluate a state updater more than once and discard an evaluation. Use `commit` entries and their `commitIndex` to identify the view that actually reached the DOM. Correlate calculations with native events using `eventId`. `native-after` is a microtask observation after delegated handlers; it can include subsequent events dispatched in the same browser task. Immediate handler/cache snapshots are recorded separately.

Non-finite values are encoded as strings (`NaN`, `Infinity`, `-Infinity`) so numeric failures are not silently converted to JSON null. Null zoom still means Fit. The final snapshot is frozen when recording stops; opening/copying/downloading the dialog cannot rewrite it.

## Observation and privacy boundaries

- Event observers are passive capture listeners. They do not prevent defaults, stop propagation, capture/release pointers, synthesize input or change app navigation state.
- Records are appended to a bounded 8,000-entry memory buffer. There is no per-move UI update, DOM layout measurement, console dump, localStorage/IndexedDB persistence, telemetry endpoint or automatic upload. Existing development-server asset/HMR traffic is unrelated to the log; no records are sent through it.
- Stop/export actions happen outside the viewer. Computed touch-action is read only for explicit start/stop snapshots; rendered styles are read inline after commits rather than forcing layout during each event.
- Reaching the limit sets `limits.truncated` and reports dropped entries. If the panel warns about the limit, make a shorter recording. Download/copy serializes only when explicitly requested, after recording stops.
- Observation adds bounded in-memory work and can affect timing slightly. It preserves the gesture formulas, event cancellation/capture policy and update order, but cannot promise zero measurement overhead. Report if the problem disappears only while recording; do not treat that as a fix.
- Only the browser's event stream is visible. Hardware/OS processing before dispatch is not observable. Desktop Firefox and Chromium CDP tests verify recording behavior, not the Android-specific root cause.

## Input-source update after native-log analysis

The four collected logs established the cause; see [device-log analysis](PINCH_LOG_ANALYSIS.md). The patched viewer uses complete native Touch snapshots for touch motion. Diagnostic `touchContacts` and `touchDistance` describe that authoritative cache; `activePointers` and `cachedDistance` still describe individual Pointer Event observations for capture/fallback. Calculation `input` distinguishes `touch` from `pointer`, while `source` remains `pinch`, `pan` or `wheel`. Touch and Pointer identifier spaces are independent.

## Further analysis if needed

Compare matching Firefox/Chrome logs before another gesture patch. Start with native contact IDs/coordinates versus the application cache, capture loss/cancellation and rejected moves, viewport/DPR changes, compatibility streams, distance/ratio discontinuities and the transition from calculations to committed views. Keep Issue #8 open and PR #9 in draft until the native cause is established and a subsequent fix is verified on the actual device.
