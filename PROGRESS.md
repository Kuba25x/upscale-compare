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

PR #1 is merged into `main`. The frontend-only demo is implemented and verified on the separate branch `feat/github-pages-demo`, based on `origin/main` (`f4b3e11`). The requested destination is `https://kuba25x.github.io/upscale-compare/`; no deployment has been performed. GitHub Pages is already configured by the owner to use GitHub Actions.

The `demo` build disables sharing and rejects public comparison routes/API helpers locally while preserving every local viewer feature. Public `.env.demo` configuration supplies the repository asset base. The existing Cloudflare backend, full production behavior, security controls, and AGPL-3.0 license are preserved. The Pages workflow defaults to `demo`, requires explicit `DEPLOY` confirmation, and retains a separate `production` choice with its original backend/key checks.

## Completed features

- Frontend-only `build:demo`, `dev:demo`, and production-bundle `test:demo` commands; no backend process or cloud configuration is needed.
- Disabled Share Comparison with visible accessible demo notices; direct shared links are refused without network requests; demo privacy information is accurate.
- Manual demo/production Pages workflow options; demo tests run before publishing the static artifact. No deployment is triggered by pushes or PRs.
- Four new configuration/API-guard unit tests and ten production demo browser cases, including no unintended API or third-party requests.

- Minimal dark landing and viewer layouts following both supplied wireframes, with a viewport-centered title, adjacent share/upload buttons, and bottom A/B controls.
- Local upload/drop of 2–4 PNG/JPEG/WebP files, replacement/addition, custom labels, dimensions/file information, original byte preservation and mismatch warnings.
- Aligned split reveal, accessible divider, equal Side-by-Side panels, shared source coordinates, source-pixel zoom, cursor anchor, pan, touch pinch, keyboard shortcuts and fullscreen.
- Optional metadata dialog and read-only public comparison details.
- Explicit consent-based publication, original private R2 storage, D1 manifests, public short URLs and GitHub Pages hash navigation/refresh, escaped social preview metadata, private deletion key backup and operator moderation.
- Server file/container/raster validation, request/metadata/dimension/size limits, production Turnstile, exact allowed origins, D1-backed rate limits, global storage reservations, concurrent-safe deletion and a scheduled janitor.
- README, contributor/security/privacy/API/architecture/deployment/testing documentation and environment examples.
- CI and manual guarded Pages/Worker deployment workflows. Generated production config disables uploads and creates no resources.

## Tests executed

Current demo task, 2026-10-26:

- `npm run build`: passed, including normal frontend/Worker TypeScript checks and both production bundles.
- `npm test`: 51 passed (35 unit + 16 local D1/R2 integration tests). Demo guards also preserve configured production sharing and local development behavior.
- `npm run test:e2e`: all 17 existing Chromium desktop, DPR 1.25/DPR 2, and mobile tests passed, including publishing, direct navigation, refresh and owner deletion.
- `npm run test:demo`: production frontend-only build and all 10 desktop/mobile browser cases passed at `/upscale-compare/`, without any Worker/API process. Cases cover local uploads, four-image selection, labels/metadata, addition/replacement, split divider, both modes, synchronized navigation, exact source-pixel RGBA, keyboard/fullscreen, privacy, shared-link rejection and static assets.
- Total automated tests: 78 passed. Demo browser interception rejected/reported unexpected requests; none occurred, and no Turnstile script/frame was present.
- Generated demo JavaScript contains neither the localhost backend address nor the Turnstile script URL. HTML script, stylesheet, favicon and runtime-license paths use the correct repository subpath.
- Full dependency audit: zero known vulnerabilities. No dependencies changed.
- Formatting, whitespace checks and visual inspection of the rendered demo landing page: passed.
- `worker/` and `LICENSE` are unchanged. No Cloudflare resources were modified, no paid services activated and no Pages deployment dispatched.

The original full application also passed hosted GitHub Actions before PR #1 was merged. Hosted validation for this separate demo branch will be recorded after its PR is created.

## Known limitations

- Demo publishing and remote comparison viewing are intentionally disabled. The real Pages URL has not been deployed or live-tested; production-bundle subpath tests run locally.

- No production deployment, Cloudflare account permission check, real Turnstile smoke test, or provider CPU budget benchmark has been performed.
- JPEG/WebP content is structurally validated, not fully decoded server-side. PNG additionally validates its bounded complete decompressed raster. Animated, interlaced PNG, or rotated/mirrored EXIF uploads are not accepted for publication.
- Browser color management applies; HDR/raw-color analysis is outside scope. Safari/Firefox and physical devices have not been tested.
- A crash before a pending row is inserted can conservatively over-count quota; the documented disabled-upload reconciliation procedure handles this.
- Per-IP limits do not stop distributed attacks or cap provider request costs. Large PNG validation may exceed Workers Free CPU allowance. Production requires operator contacts, monitoring, provider quota review and approval.
- No automatic expiration: active links persist until owner/operator deletion. Local unpublished state is intentionally lost on refresh.

## Exact next steps

1. Commit and push the verified demo changes, open a new PR targeting `main`, and record the PR/hosted CI result here.
2. After review and merge, the owner can deploy manually: Actions → Deploy frontend to GitHub Pages → Run workflow → branch `main` → `deployment_mode=demo` → `confirmation=DEPLOY` → Run workflow. Follow `docs/DEPLOYMENT.md`.
3. Do not dispatch deployment on the owner's behalf. Demo deployment requires no Cloudflare credentials or resources. Keep full production sharing disabled until its separate provider setup and authorization are complete.
4. Continue from this branch/PR rather than restarting implementation. Preserve the existing full-stack code and tests for future Cloudflare integration.
