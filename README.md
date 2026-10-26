# Upscale Compare

A focused, open-source image quality comparison tool for game screenshots. Compare DLSS, FSR, XeSS, native rendering, anti-aliasing, or any custom configuration directly in your browser. **Screenshots stay local until you explicitly publish.**

## Features

- Minimal dark interface: centered title, a central upload button, an almost full-screen viewer, and a compact A/B selection bar.
- Two to four PNG, JPEG, or static WebP screenshots, editable labels, and original resolution/file information.
- Split Screen with an accessible draggable divider and synchronized Side-by-Side inspection.
- Cursor-centered wheel zoom, drag navigation, touch pan and pinch, fullscreen, and keyboard shortcuts.
- Fit plus physical-pixel 100%, 200%, and 400% presets. 100% means one source pixel per physical display pixel, including on HiDPI displays.
- Optional game, upscaler, preset, rendering resolution, GPU, graphics settings, and description metadata.
- Explicit public publishing, immutable comparison snapshots, short share links, social preview metadata, private deletion keys, and operator moderation.
- Original file bytes are stored and served without re-encoding. Different dimensions use the same scale and top-left origin; images are never stretched to match.

## Quick start

Requires Node.js 22 or later (Node.js 24 is used in CI) and npm. No Cloudflare account is required for local development.

```bash
npm ci
cp .env.example .env
npm run db:local
npm run dev:api
```

In a second terminal:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Upload two screenshots. Local sharing uses Wrangler's persistent D1 and R2 emulation on port 8787. Local share URLs work only while that service is running and are not Internet-public. Do not expose the development Worker to the Internet.

In a restricted environment where your home configuration directory is not writable, prefix Wrangler commands with `XDG_CONFIG_HOME=/tmp/upscale-compare-config`. Disable optional Wrangler telemetry with `WRANGLER_SEND_METRICS=false`.

## Controls

| Action                      | Control                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| Pan both images             | Drag / arrow keys                                                 |
| Zoom at the cursor          | Mouse wheel                                                       |
| Touch navigation            | One-finger drag / two-finger pinch                                |
| Fit complete images         | `0`                                                               |
| 100%, 200%, 400%            | `1`, `2`, `4`                                                     |
| Zoom in / out               | `+`, `-`                                                          |
| Split Screen / Side-by-Side | `S`, `V`                                                          |
| Swap A and B                | `X`                                                               |
| Previous / next image for A | `[`, `]`                                                          |
| Fullscreen                  | `F`                                                               |
| Help                        | `?`                                                               |
| Move divider                | Drag handle; focus it and use arrow keys, Shift+arrows, Home, End |

At explicit integer magnifications the image origin is snapped to physical pixels and nearest-neighbor rendering is used. Fit can resample the display to show the complete image; it never changes the underlying file. Browser zoom and display changes are reflected through `devicePixelRatio`. Color management is controlled by the browser; this is not an HDR or raw-color analysis tool.

## Development and validation

```bash
npm run typecheck
npm run build
npm test
npm run test:e2e
```

Playwright uses `/usr/bin/chromium` by default. On other systems:

```bash
npx playwright install chromium
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

Use `node -e "console.log(require('playwright').chromium.executablePath())"` to locate the downloaded browser. End-to-end tests launch Vite and local Wrangler automatically. Unit and API tests use isolated Miniflare D1/R2 instances. See [testing](docs/TESTING.md) for coverage and executed results.

## Architecture

```text
Browser (React + TypeScript + Vite)
  ├─ Local object URLs → image inspection; no image network traffic
  └─ Explicit publish → Cloudflare Worker
                         ├─ D1: immutable manifests, deletion hashes, rate limits, quota
                         └─ Private R2: unmodified originals
GitHub Pages → frontend (/upscale-compare/ supported)
Worker /s/<id> → Open Graph metadata → frontend #c/<id>
```

Hash routes make direct links and browser refreshes work on GitHub Pages without server rewrites. The Worker share URL provides server-generated social metadata. Frontend and backend deployments are independent. See [architecture](docs/ARCHITECTURE.md), [API](docs/API.md), and [deployment](docs/DEPLOYMENT.md).

## Limits and security

Defaults: 2–4 images, 20 MiB per file, 40 MiB total per publication, 36 megapixels per image, and 16,384 pixels per side. The server also enforces configurable request, storage, comparison-count, and IP rate limits. Public PNG publishing accepts non-interlaced still images. Rotated/mirrored EXIF images must be exported with normalized orientation before publishing. JPEG/WebP validation checks container structure and dimensions; PNG validation additionally checks chunk CRCs and the complete bounded decompressed raster. See [security](SECURITY.md) for scope and limitations.

Production requires an allowed HTTPS frontend origin, private R2, initialized D1, a Turnstile challenge, and operator-configured moderation. Deployment workflows are manual and require a `DEPLOY` confirmation. The API workflow deploys with public uploads **disabled**. No paid resources are created automatically. See [deployment and free-tier limitations](docs/DEPLOYMENT.md) before enabling uploads.

## Privacy and deletion

Unpublished images exist only in browser memory and are lost on refresh. Published screenshots are public to anyone with the link, including embedded metadata in the original files. A private deletion key is saved in browser storage; download a backup after publishing. Open the shared comparison and choose **Share Comparison → Manage published comparison** to delete it. A key is not included in public URLs. Deletion cannot recall copies already downloaded elsewhere. See [privacy](docs/PRIVACY.md).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [PROGRESS.md](PROGRESS.md). All project content is in English. This project is licensed under the existing **GNU Affero General Public License v3.0**; see [LICENSE](LICENSE). Modified hosted versions must provide corresponding source under the AGPL. The interface includes a source-code link; update it when operating a fork.
