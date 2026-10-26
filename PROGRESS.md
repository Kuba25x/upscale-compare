# Development progress

## Project constraints

All application content, code, documentation, commits, and PRs must be in English. User conversation is in Polish. Preserve the existing AGPL-3.0 license. Do not deploy to production, create paid resources, or incur costs without explicit approval.

## Design and architecture

The supplied wireframes are the layout authority: a narrow header with a geometrically centered title; an almost empty landing page with a centered upload button; a full-viewport viewer with mode controls on the left, adjacent Share Comparison and Upload Images buttons on the right, and a narrow bottom A/B selection and label bar. Dark theme, subtle lime accent. No sidebar or marketing sections.

React + TypeScript + Vite frontend for GitHub Pages. Separate Cloudflare Worker API, private R2 originals, D1 records, quota and rate-limit ledger. Local Wrangler/Miniflare development requires no Cloudflare account. Screenshots remain local until explicit publishing. Public pages are read-only; deletion uses a private capability token.

## Implementation plan

1. Implement local upload, the two layouts, shared image coordinates, split divider, synchronized navigation, source-pixel zoom, keyboard/touch controls, and unobtrusive metadata.
2. Implement validated publishing, persistence, public URLs, deletion and moderation, quota/rate limits, and local emulation.
3. Execute unit, Worker integration and Chromium end-to-end tests; verify rendered pixel alignment and mobile layouts; fix issues.
4. Complete contributor, security, privacy and deployment documentation and guarded manual deployment workflows.
5. Commit verified milestones and prepare a reviewable PR if GitHub access permits.

## Current status

The complete application is implemented locally on branch `feat/upscale-compare`. No production resources have been created or deployed. Cloudflare credentials are absent. Git remote read access and the GitHub connector work; an initial `gh auth status` reported an invalid injected token, so use ordinary configured Git for pushes and the GitHub connector for PR creation.

## Completed features

- Minimal dark landing and viewer layouts following both supplied wireframes, with a viewport-centered title, adjacent share/upload buttons, and bottom A/B controls.
- Local upload/drop of 2–4 PNG/JPEG/WebP files, replacement/addition, custom labels, dimensions/file information, original byte preservation and mismatch warnings.
- Aligned split reveal, accessible divider, equal Side-by-Side panels, shared source coordinates, source-pixel zoom, cursor anchor, pan, touch pinch, keyboard shortcuts and fullscreen.
- Optional metadata dialog and read-only public comparison details.
- Explicit consent-based publication, original private R2 storage, D1 manifests, public short URLs and GitHub Pages hash navigation/refresh, escaped social preview metadata, private deletion key backup and operator moderation.
- Server file/container/raster validation, request/metadata/dimension/size limits, production Turnstile, exact allowed origins, D1-backed rate limits, global storage reservations, concurrent-safe deletion and a scheduled janitor.
- README, contributor/security/privacy/API/architecture/deployment/testing documentation and environment examples.
- CI and manual guarded Pages/Worker deployment workflows. Generated production config disables uploads and creates no resources.

## Tests executed

- `npm run build`: passed, including separate frontend/Worker TypeScript checks.
- `npm test`: 46 passed (30 unit + 16 Miniflare API integration tests).
- Chromium desktop, DPR-2 and mobile browser suite: 15 passed at the preceding checkpoint; all 16 tests passed, including owner key recovery/deletion and the friendly deleted-link page.
- Actual screenshot pixel samples match original RGBA at 100% on DPR 1 and 2.
- Desktop/mobile screenshots visually inspected. Title text and landing-button centering refinements are covered by the passing browser run.
- Production dependency audit: zero known vulnerabilities. Full tooling audit initially found test-tool advisories; Vitest was upgraded to 5.0.5. The direct stable Miniflare dependency still requires alignment with Wrangler's already-patched 5.20261023.0-beta dependency.
- Initial test failures (cursor anchor rounding, dialog persistence on hash navigation, ambiguous test selectors and mobile expected percentage) were corrected; the prior 15-test suite passed completely.

## Known limitations

- No production deployment, Cloudflare account permissions, real Turnstile smoke test, provider CPU budget benchmark, or GitHub-hosted Actions run has been performed.
- JPEG/WebP content is structurally validated, not fully decoded server-side. PNG additionally validates its bounded complete decompressed raster. Animated, interlaced PNG, or rotated/mirrored EXIF uploads are not accepted for publication.
- Browser color management applies; HDR/raw-color analysis is outside scope. Safari/Firefox and physical devices have not been tested.
- A crash before a pending row is inserted can conservatively over-count quota; the documented disabled-upload reconciliation procedure handles this.
- Per-IP limits do not stop distributed attacks or cap provider request costs. Large PNG validation may exceed Workers Free CPU allowance. Production requires operator contacts, monitoring, provider quota review and approval.
- No automatic expiration: active links persist until owner/operator deletion. Local unpublished state is intentionally lost on refresh.

## Exact next steps

1. Align the direct Miniflare test dependency with Wrangler's patched Miniflare version, rerun tests and the full dependency audit.
2. Finish a browser smoke test of the production repository-subpath build, final formatting and documentation. Production config generation and Worker dry-run packaging already passed with dummy IDs; no deployment occurred.
3. Commit the final tooling/documentation checkpoint, push the feature branch and create/attach a PR.
4. Leave production disabled. After owner approval, configure Cloudflare resources/secrets, GitHub environment variables and hosting, then execute documented production smoke tests before enabling uploads.
