# Architecture

## Source layout

| Path                                | Responsibility                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/App.tsx`                       | Landing/viewer state, local file lifecycle, hash navigation, header and A/B controls          |
| `src/components/Viewer.tsx`         | Rendering, shared navigation, divider, pointer/touch/keyboard interactions                    |
| `src/components/ShareDialog.tsx`    | Explicit publish consent, Turnstile, copy link, deletion capabilities                         |
| `src/components/MetadataEditor.tsx` | Optional metadata and read-only published details                                             |
| `src/lib/geometry.ts`               | Pure coordinate, fit, physical pixel scale, anchor and pan calculations                       |
| `shared/model.ts`                   | Shared TypeScript models, Zod schemas and default limits                                      |
| `worker/src/index.ts`               | Worker routing, validation pipeline, quota/rate control, persistence, deletion and share HTML |
| `worker/src/image-validation.ts`    | Bounded image-content validation without file re-encoding                                     |
| `worker/src/upload.ts`              | Bounded multipart buffer, field parsing and per-isolate publication admission                 |
| `worker/src/publication-store.ts`   | Atomic quota/pending records, guarded activation, deletion and scheduled recovery             |
| `worker/migrations`                 | D1 schema migrations                                                                          |
| `tests`                             | Geometry/schema, image-content, real local Worker integration, browser/pixel/touch coverage   |

## View coordinates

Every screenshot uses source coordinates measured from its top-left pixel. The view stores a shared source center and physical magnification. For explicit zoom:

```text
CSS scale = magnification / devicePixelRatio
CSS image position = panel center - source center × CSS scale
```

At 100%, a source pixel occupies one physical display pixel. At integer magnifications the image origin is rounded to a physical pixel. At Fit, both selected images share a scale computed from their union dimensions and the available panel rectangle. No resolution normalization is performed. Side-by-Side uses equal panel sizes; split mode uses two fully overlapping panels clipped at the same divider position. The divider never changes the image transform.

The position is applied using a translation, with image dimensions set separately. This avoids Chromium rounding fractional CSS layout positions before physical-pixel rasterization, particularly in Side-by-Side mode on HiDPI displays. Both panels snap against the global physical screen grid, including fractional display densities such as 125%.

Wheel zoom preserves the source coordinate under the cursor, including any rounding used for the rendered origin. Pan deltas are divided by the current CSS scale. Both panels use the same view. Switching modes preserves the source center and explicit magnification; Fit recalculates the scale for the new panel geometry.

Touch pointers are tracked through pointer capture. One pointer pans; two pointers change magnification around their midpoint. The divider has its own pointer capture and keyboard slider semantics. Native HTML selects and dialogs provide image selection and focus trapping without a third-party UI framework.

## File lifecycle

Selected files become browser object URLs and are decoded locally. Failed batches revoke every object URL already created. Replacing files revokes previous local URLs. No file is uploaded on selection, editing, zooming, or panning. Unpublished state is intentionally not persisted to IndexedDB; refresh loses it.

The publish dialog snapshots labels, metadata, mode, selection, divider, source center and zoom. Original file data is sent as multipart form data. The Worker ignores original filenames and serves generated safe filenames. It does not transcode image data.

The [original-fidelity matrix](ORIGINAL_FIDELITY.md) verifies source/R2/HTTP byte
identity and reconstruction from the production bundle, including mixed formats,
embedded metadata, 16-bit PNG, alpha, physical-pixel zoom and viewport-dependent
Fit. Browser decoding/color management is distinct from preservation of the
encoded original.

## Persistence and failure behavior

Upload parsing and validation use bounded resources: one multipart buffer per
isolate, at most two waiting publications, limited headers/parts and container
structure, and pull-based PNG decompression. Original image entries reference
buffer slices through sequential R2 writes. See [resource limits](RESOURCE_LIMITS.md)
for ceilings, overload behavior and production verification boundaries.

1. Require uploads enabled, allowed origin, request rate limit, bounded multipart, valid manifest, production verification, and valid file content.
2. Atomically insert the pending record and reserve byte/count quota through its D1 trigger.
3. Write originals sequentially, checking the pending deadline/state before each write.
4. Conditionally activate only the still-pending record after all originals are stored.
5. Return a short public share URL. The client generated and saved the separate deletion capability before upload.

Publication attempts have a timestamped random identifier and a private deletion
key, carried only in request headers. A unique D1 retry marker is inserted in the
same transaction as the pending row/quota; it binds normalized metadata and
ordered original-byte hashes. Concurrent retries return pending/active state
without another writer. The browser persists a small private recovery journal
before the first request, checks results without image uploads, and restores the
owner UI after refresh. See [recoverable retries](PUBLICATION_RETRIES.md) for the
24-hour window, migration 0003, tombstones and explicit terminal-state handling.

Readers only see active records. Compensation targets all four possible R2 keys,
then releases quota and removes the marker in one D1 transaction. An ambiguous
activation result never erases a record which is already active. Failed cleanup
retains a non-public marker and its reservation for scheduled retry.

The janitor processes up to 10 due records per hourly run with conditional claims,
five-minute leases, retry backoff and priority for less-attempted records. One
record's failure does not stop independent cleanup. Expired pending uploads retain
an extra one-hour deleting marker/reservation and are swept again before release
so late writes can be removed. Normal active deletion finalizes immediately when
storage succeeds. See [publication recovery](PUBLICATION_RECOVERY.md) for the state
machine, migration, retention and operational boundaries. D1/R2 writes are not a
cross-service atomic transaction.

## Cost controls

Stage 4 adds `service_control` and UTC-keyed `daily_usage`. Conditional admissions
charge body capacity before receiving uploads and public reads before per-IP
writes/lookups/R2. Daily pending-publication charges join the existing insert
transaction. A private operator endpoint stops publishing without deployment;
the stored generation is checked after intake, before writes, and by D1 INSERT/
activation triggers. Resume cannot revive older admissions. See [cost controls](COST_CONTROLS.md)
for all counters, exemptions, non-refunds, defaults and billing boundaries.

Stage 7 adds a main-only, Free-only production release lock, rejects paid CPU
overrides and leaves generated production cron disabled. Expired rate rows are
purged in indexed batches of at most 100; comparison recovery remains independent
of retention failure. [Operations](OPERATIONS.md) defines maintenance, emergency
edge shutdown, restore/rollback and owner decisions; [Free-tier evidence](FREE_TIER_OPERATIONS.md)
records the CPU/memory/R2 blockers. These are not a provider spending cap.

## URLs and privacy

The canonical public link is `https://api-host/s/<16-hex-id>`. Its server-generated HTML includes escaped Open Graph metadata and redirects to `FRONTEND_URL#c/<id>`. GitHub Pages serves the same static entry point for every hash route, including repository subpaths. Social services receive an original selected image, not a generated composite; provider caching and preview support vary.

Published manifests are immutable. Visitors may change navigation or selection in memory but cannot change stored files, labels, or metadata. Uploading from a shared page creates a fresh local comparison. Deletion capabilities are stored in browser localStorage under API origin + comparison ID and can be downloaded privately. They are never part of public manifests, URLs, or logs.

## Shared comparison presentation

`App` and `Viewer` consume `ComparisonPresentation`: edge-to-edge layout readiness,
compact controls, minimalist presentation, a viewport transition key, and safe/layout
insets in CSS pixels. The image panel's open state belongs to `App`. Shared
`comparison-*` classes and CSS variables describe presentation without controlling
system bars, orientation, or storage. Desktop web retains its existing layout and
Fullscreen API behavior; mobile web can opt into the shared minimalist presentation.

Only the Android entry dynamically loads `AndroidApp`, native services, and the
Capacitor plugins. `useAndroidDisplay` accepts revision-ordered native measurements
and converts physical pixels using the WebView DPR before passing presentation to
the shared UI. Native display policy, Photo Picker/Files import, session persistence,
Back, and lifecycle handling retain their existing behavior. Layout transitions
resize the existing image layers rather than remounting the viewer. Android's
offline sharing visibility policy remains separate from the shared layout styles.

### Mobile browser landscape

`WebApp` supplies browser presentation through `useWebViewport`, without loading
Capacitor. Compact controls require a primary coarse pointer without hover, physical
landscape orientation, a width of at most 1120 CSS pixels and a height of at most
620 CSS pixels. Orientation comes from Screen Orientation, with legacy window angle
and screen-dimension fallbacks. A portrait keyboard shrinking the viewport cannot
enable landscape controls; mouse-first touchscreen desktops retain their normal UI.

The compact header is 52 CSS pixels plus its safe top inset. Images opens an overlay
for the existing A/B selectors, labels, swap, sharing button and sharing notice.
Closing the panel releases keyboard focus to its toggle. Zoom presets use the shared
selector, and metadata stays in the existing dialog. Demo sharing remains disabled.
All four browser safe-area insets protect controls. ResizeObserver and VisualViewport
events update measurements and keep panels/dialogs within the visible keyboard area.
Changes to the actual stage rectangle, orientation or DPR cancel active gestures,
preserve source center/divider/explicit zoom and resize the existing image layers.
Fit recalculates for the available stage. Android still uses its native adapter.

`tests/shared/mobile-landscape.ts` exercises 844×390, 900×412 and 500×240 layouts in
both comparison modes, focus, keyboard/inset simulations, rotation and image identity.
Chromium additionally verifies sampled pixels, touch interruption and DPR changes.
The demo suite enables Firefox and WebKit coverage with `RUN_FIREFOX=true` and
`RUN_WEBKIT=true`; CI installs these browsers. This emulation does not qualify real
mobile browser chrome, keyboards or iOS Safari.

### Mobile browser minimalist mode

Primary coarse-pointer browsers without hover offer minimalist entry at widths up
to 1120 CSS pixels in either orientation. `useMobileFullscreen` owns a presentation
session independently of the browser's actual fullscreen element. Entry immediately
shows only the image layers, split divider and safe-area-aware exit button. The
standard Fullscreen API request runs in that same user action when request and exit
methods are available. A missing, partial, throwing or rejected API leaves a usable
CSS view inside the browser; it does not open help. Desktop fullscreen keeps its
controls and its existing help-on-error behavior.

`fullscreenchange` closes an observed fullscreen session on system exit. Exit and
Escape also work in the CSS fallback, release active gestures through the existing
viewer transition, and return focus to the entry control. Requests that complete
after cancellation cannot reopen the view; overlapping entry/exit operations keep
the latest presentation intent. Eligibility is checked at entry, so rotation or a
wider viewport cannot unexpectedly abandon an active comparison. No orientation
lock, Capacitor or native system-bar calls are made by this adapter.

The same Viewer and original image nodes survive entry, rotation and exit. Selection,
metadata, source center, divider, explicit zoom and physical-pixel mapping retain
their values; Fit follows available space. Tests cover real Chromium/Firefox
fullscreen, API outcomes, asynchronous cancellation, focus, CSS fallback, both modes,
safe areas and image identity in Chromium/Firefox/WebKit. CDP touch injection and
RGBA pixel sampling run in Chromium. Real Chrome/Firefox on Android and iOS Safari
still require device acceptance before proceeding to the PWA phase.

## Demo build boundary

`src/lib/config.ts` identifies Vite mode `demo` or an explicit `VITE_DEMO_MODE=true` flag. The Pages workflow defaults to `demo` and builds with `npm run build:demo`. A separate production-bundle browser suite requires no backend process. The default full-stack scripts and Worker implementation are preserved.

In demo mode, Share Comparison stays disabled and described by a visible notice in the normal layout or compact image panel. Minimalist mode hides those controls. The sharing dialog never mounts. Direct hash routes explain that sharing is unavailable before fetching metadata or constructing image URLs. API helpers additionally reject requests/remote URL construction and expose no localhost fallback. A configured API URL or Turnstile key cannot enable networking in a demo build.
