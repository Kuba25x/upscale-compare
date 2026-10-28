# Original files and comparison restoration

Share Comparison stage 6 verifies original-file transport and reconstruction of
an immutable comparison. It builds on stages 1–5 from `main` at `bd6966b`.
All storage and publication in this stage use local emulators. No production
service, plan, budget, deployment or public upload gate is changed.

## Preservation contract

The frontend keeps each selected `File` and sends it as multipart file data. The
Worker validates its content and writes the same bytes to private R2; public
image requests stream that object. No canvas export, resampling, recompression,
thumbnail or composite replaces a source file. This preserves JPEG/lossy WebP
as supplied; it cannot undo loss already introduced by their original encoders.

Original **bytes** include transparency, 16-bit samples and embedded EXIF, ICC,
text and other ancillary metadata. Publication does not remove private metadata.
The generated public filename (`screenshot-N.png`, `.jpg` or `.webp`) intentionally
replaces the source filename; labels and the file's embedded metadata are separate.
Only supported still PNG/JPEG/WebP within the existing resource limits can be
published. Rotated/mirrored EXIF must be normalized by the user before publishing;
the application does not silently rotate or re-encode it. Interlaced PNG and
animated-image publication remain unsupported.

The manifest preserves image order, labels, per-image metadata, comparison
metadata, selected A/B indices, mode, divider and view (`zoom` plus source-space
center). Text is validated/trimmed by the existing shared schemas; supported
Unicode and internal newlines/tabs survive. Stored comparisons are immutable.
Visitor navigation changes only that page's state; refresh restores the published
snapshot.

Explicit zoom is a physical source-pixel magnification: 100% maps one source
pixel to one physical screen pixel, using the recipient's DPR. Fit recomputes a
shared scale for the selected dimensions and available panel. A different screen,
mode or window size can therefore produce a different crop/fit result while
restoring the same stored settings. Different source dimensions share a top-left
coordinate system and scale; they are never stretched to match. Fullscreen,
browser zoom, window size, focus, owner credentials and unsaved visitor changes
are not part of a public comparison.

## Reproducible checks

```bash
npm run build
npm test
npm run test:sharing:local
```

The sharing target uses the [stage-5 local harness](LOCAL_SHARING_VALIDATION.md):
optimized production frontend at `/upscale-compare/`, real production-mode Worker,
fresh local D1/R2 and offline verification doubles. It needs no Cloudflare account
or live verification keys. Existing full viewer/demo suites remain regression
checks.

### Generated fixture matrix

All eight files in `tests/fixtures/fidelity/` are generated pixels and synthetic,
public metadata. They contain no game assets or private screenshots. The catalog
records byte size, dimensions, features and SHA-256 for each file.

| File                  | Source properties                                        |
| --------------------- | -------------------------------------------------------- |
| `rgba-metadata.png`   | RGBA8, partial alpha, ICC, EXIF orientation 1, text, DPI |
| `rgb16.png`           | True 16-bit RGB samples, sRGB chunk                      |
| `indexed-alpha.png`   | Indexed palette and tRNS transparency                    |
| `baseline.jpg`        | Baseline lossy JPEG, ICC, EXIF orientation 1             |
| `progressive.jpg`     | Progressive lossy JPEG, EXIF orientation 1               |
| `lossy.webp`          | VP8 lossy, ICC, EXIF orientation 1                       |
| `lossless-alpha.webp` | VP8L lossless, partial alpha, ICC, EXIF orientation 1    |
| `uhd.png`             | 3840 × 2160 RGB grid                                     |

Optional regeneration uses Python 3 and Pillow 12.3.0, outside the normal Node/CI
requirements:

```bash
python3 scripts/generate-fidelity-fixtures.py
npx prettier --write tests/fixtures/fidelity/manifest.json
```

Review regenerated binaries and hashes together. Encoder/library versions can
change encoded bytes. The suite consumes committed fixtures, not a local Pillow
installation. The generator fixes ICC creation time and records its Pillow version.

### Evidence layers

- Production-mode API tests compare source SHA-256 against both actual R2 bytes
  and HTTP GET bodies, with direct byte equality as well. HEAD/GET checks include
  MIME, byte length, generated filename, no-store, CORS and nosniff. Quota equals
  the sum of original file sizes.
- Mixed 2/3/4-file publications preserve order, distinct Unicode labels and all
  per-image/comparison metadata. A 12-case matrix covers both modes, Fit and
  explicit zoom 0.025/1/1.25/2/16, boundary dividers, swapped/non-adjacent selection
  and fractional/negative source centers without numeric quantization.
- Replacing EXIF orientation with 2–8 in JPEG, plus rotated PNG and mirrored WebP,
  produces an explicit rejection with no comparison, retry marker, quota
  reservation or R2 object. No automatic normalization is introduced.
- Browser cases publish through the real UI and verification contract, then visit
  the canonical link with owner storage cleared. They compare downloaded byte
  hashes and browser-decoded RGBA hashes with the selected local files, including
  all eight formats/variants. Metadata is checked against known entered values.
- Rendered sizes and source centers are checked from actual element geometry
  after direct navigation and refresh, at DPR 1/1.25/2 and mobile emulation. Cases
  use Fit, 100% and 250%, panning, both modes, mismatched dimensions and 2–4 files.
  Public-panel screenshots additionally reproduce six known original pixel
  samples at 100% across those four browser configurations.
- Visitor mode/selection/zoom changes leave the public API manifest unchanged;
  refresh restores it. A missing original refuses partial reconstruction and
  shows an error instead of presenting an incomplete comparison.

The existing complete 40 MiB/two-20-MiB original-byte regression and stage-1
large-raster/resource limits remain in the API/unit suite. These checks do not
measure production CPU, memory or billing margins.

## Executed results

On 2026-10-28, the final build/typechecks and local suites passed: **277 unit/API +
45 regular browser + 37 production-sharing browser + 31 demo = 390 cases**.
This stage adds 32 API and 17 browser cases. Formatting and `git diff --check`
passed, and fixture regeneration reproduced all eight catalog hashes/entries.
The tested application/Worker paths already preserved originals and restored
settings; no production-code fix was needed. These are local execution results;
hosted CI is reported separately on the PR.

## Real screenshot and physical-device acceptance

Generated inputs establish deterministic transport and restoration behavior.
They cannot certify every capture/export tool, codec, color profile or physical
screen. The following operator acceptance remains necessary before claiming
those specific combinations work. It can use local development; it does not
authorize a production upload service.

For representative asset testing, provide a ZIP containing **unmodified source
files**, not pasted/re-saved previews:

1. A set of 2–4 captures of the same scene from the tools actually used, with
   distinct upscaling variants. Include PNG and any JPEG/WebP workflow you intend
   to support, preferably a 4K capture and an 8K capture if 8K is part of your use.
2. If relevant, a mismatched-resolution pair, an alpha-channel image, and a
   16-bit/ICC-tagged SDR image. Include a valid near-20-MiB file if this size is an
   expected workflow; keep the publication total at most 40 MiB and each image
   within 36 MP/16,384 pixels per side.
3. Capture tool/version and export settings, expected pixel dimensions, byte
   lengths and SHA-256 values, intended A/B order/labels, metadata and view. Use
   non-private assets: exact preservation also retains embedded identifying data.

On Windows, hashes can be recorded with `Get-FileHash -Algorithm SHA256`; on
Linux/macOS use `sha256sum`/`shasum -a 256`. To verify a supplied file, download its
original `/api/comparisons/<id>/images/<index>` response and hash the saved file.
Do not compare a browser screenshot or a social-platform preview to the source
file hash. A live/provider-hosted round trip still requires separate authorization.

For manual local desktop testing, follow README's local setup (`npm run db:local`,
`npm run costs:local`, `npm run dev:api` and `npm run dev`). Use two browser profiles
for publisher and visitor. The development API deliberately omits real Turnstile;
use the automated target above for production-branch verification. Do not point
these fixtures or local allowances at remote resources.

Report this device checklist with model, OS/browser version, display scaling/DPR,
browser zoom, capture set and any failures:

- Windows Chrome/Firefox at 100% and 125%/200% display scaling; actual Android
  Chrome/Firefox and iOS Safari if those platforms will be supported. For Android
  USB testing, `adb reverse tcp:5173 tcp:5173` and
  `adb reverse tcp:8787 tcp:8787` let the phone use the local development app at
  `http://localhost:5173/` without a public service. Use a trusted local development
  connection for iOS; it requires matching frontend/API URLs and allowlisted origin.
- Publish a recognizable crop with swapped A/B, custom labels, metadata, divider,
  panning and explicit zoom. Open the link in a fresh profile/device, then refresh.
  Confirm exact settings and hash all downloaded originals. Repeat using Fit and
  both modes; Fit should adapt rather than copy the publisher's window geometry.
- At 100% browser zoom, inspect fine text, edges, alpha boundaries and the chosen
  source crop at 100%/200%/400% app zoom. Check portrait/landscape and resizing,
  switching images/modes, touch pan/pinch and continued local navigation.
- Check owner deletion and errors when a source/link is unavailable. Record color
  differences separately from file/hash or geometry failures.

Decoded browser RGBA equality in this suite uses that browser's default canvas
conversion. It does **not** prove preservation of 16-bit precision on screen,
wide-gamut/colorimetric equality across browsers/displays, HDR correctness,
physical-device performance or production CDN/D1/R2 behavior. HDR inspection is
still unsupported. Real source assets and device results have not been supplied
for this stage; none are claimed as tested. Later deployment/operations work is
not started.
