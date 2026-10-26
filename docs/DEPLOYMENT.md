# Deployment and operation

Production is deliberately not deployed by default. Do not create resources, enable billable services, expose the development Worker, or enable public uploads without the project owner's approval.

## 1. Provision approved Cloudflare resources

After approval, create a private R2 bucket and a D1 database named `upscale-compare`. R2 activation may require billing details even when expected usage is within the free allowance. Do not turn on R2 public bucket access, r2.dev access, or unrestricted client uploads.

Create a narrowly scoped API token for deploying the Worker and accessing only the intended D1/R2 resources. Keep it in GitHub environment secrets or your local secret manager, never in this repository. Create a Cloudflare Turnstile widget restricted to your frontend hostname, and provide the public site key to the frontend build.

No credentials are needed for `npm run db:local`, `npm run dev:api`, or the test suite.

## 2. Prepare production configuration

```bash
D1_ID=your-database-uuid \
BUCKET=your-private-bucket \
FRONTEND_URL=https://your-user.github.io/upscale-compare/ \
node scripts/prepare-production.mjs
```

This generates an ignored `worker/wrangler.production.json` and creates no resources. It defaults to `ENVIRONMENT=production`, exact allowed frontend origin, a 5 GiB storage cap, 1,000 comparisons, five publish attempts per IP per hour, 240 reads per IP per minute, and `UPLOADS_ENABLED=false`. Review and lower limits as appropriate. Do not deploy `worker/wrangler.jsonc`: that configuration is for local development and bypasses Turnstile.

After authorization, apply migrations and deploy the disabled API:

```bash
npx wrangler d1 migrations apply upscale-compare --remote --config worker/wrangler.production.json
npx wrangler deploy --config worker/wrangler.production.json
npx wrangler secret put TURNSTILE_SECRET --config worker/wrangler.production.json
npx wrangler secret put ADMIN_TOKEN --config worker/wrangler.production.json
```

Use a fresh random admin secret of at least 32 bytes. Keep it separate from user deletion keys. Rotate it using Wrangler if exposed. These commands require external authentication and are not run during implementation.

## 3. Build and publish the frontend

GitHub repository variables:

| Variable                  | Example                                                  |
| ------------------------- | -------------------------------------------------------- |
| `VITE_API_URL`            | `https://upscale-compare-api.your-subdomain.workers.dev` |
| `VITE_TURNSTILE_SITE_KEY` | Public Turnstile site key                                |

Select GitHub Actions as the Pages source in repository settings. The manual **Deploy frontend to GitHub Pages** workflow builds with `VITE_BASE_PATH=/<repository-name>/`. Run it only when deployment is approved and type `DEPLOY`. It runs unit, API and browser tests before publishing. A custom domain hosted at `/` needs `VITE_BASE_PATH=/` instead; adjust the workflow intentionally.

For a manual build:

```bash
VITE_BASE_PATH=/upscale-compare/ \
VITE_API_URL=https://your-api.example \
VITE_TURNSTILE_SITE_KEY=your-public-site-key \
npm run build
```

Publish only `dist/`. Hash comparison routes work without a 404 rewrite. Shared social-preview links come from the Worker `/s/<id>` endpoint, because GitHub Pages cannot generate comparison-specific HTML metadata.

GitHub Pages does not let this project set custom response headers. The API sets its own restrictive headers; a frontend host supporting headers can additionally configure a CSP. Allow scripts and frames for `https://challenges.cloudflare.com`, API connections/images, and local blob image URLs when doing so.

## 4. Optional backend workflow

Create a protected GitHub environment named `cloudflare-production`. Configure:

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Variables: `CLOUDFLARE_D1_ID`, `CLOUDFLARE_R2_BUCKET`, `FRONTEND_URL` (including repository path and trailing slash).

The manual **Deploy Cloudflare API** workflow requires `DEPLOY`, runs build/tests/browser checks, generates production configuration, applies migrations, and deploys with uploads disabled. It does not provision resources or set Turnstile/admin secrets. Add required reviewers in the GitHub environment if available. Re-running this workflow intentionally disables uploads again; enable them only after operator review.

## 5. Enable uploads after verification and approval

Before enabling public uploads, publish the operator's privacy/security/abuse contacts and review the limits. Verify real Turnstile behavior on the production frontend, secret bindings, private bucket permissions, allowlisted origins, byte identity, public-link refresh, owner deletion, admin moderation and scheduled cleanup. These production checks cannot be established by local emulation.

Set `UPLOADS_ENABLED` to `true` in your generated production config and redeploy only after authorization. A missing Turnstile secret still fails closed. Keep an immediate shutdown path: set it back to `false` and redeploy. Existing published comparisons remain readable when uploads are disabled.

## Free-tier and cost limitations

Cloudflare's allowances and pricing change; check the current Workers, D1, R2 and Turnstile pricing before enabling resources. This repository makes no promise of free hosting at arbitrary traffic levels.

- Workers Free has a strict CPU allowance. Structural validation and full PNG CRC/decompression for large screenshots can exceed it. Local workerd tests do not enforce production billing/CPU limits. Benchmark approved real workloads; lower file/pixel limits or obtain approval for a suitable plan.
- A 5 GiB application cap conservatively bounds active/reserved original data; it does not cap R2 request costs, provider logging/backups, or D1/Worker requests.
- D1 has read/write/storage limits. Rate counters and per-request visibility checks consume operations. High-traffic links may hit allowances even with few stored images.
- R2 free allowances are not a spending limit. This application does not pay for or enable an external image transformation service.
- Every image response checks deletion state and uses `no-store`. This favors reliable takedown over aggressive CDN caching and increases reads.
- Per-IP limits and Turnstile reduce abuse but do not guarantee protection against distributed traffic. Add Cloudflare edge rules, provider limits, budget alerts, monitoring and an upload kill switch before opening a high-traffic service.

## Moderation and maintenance

The admin secret can delete any comparison with `DELETE /api/comparisons/:id` and `Authorization: Bearer <ADMIN_TOKEN>`. Use a secret-aware API client; do not paste credentials into issue comments or command history. No administrator UI or authentication cookies are provided.

The hourly scheduled handler removes expired rate rows and retries abandoned pending/deleting records older than an hour. Active comparisons are permanent until explicitly deleted. Monitor failed scheduled runs and storage usage. R2 and D1 should be backed up under your own retention policy; protect backups as public-upload data with private deletion hashes.

If a crash occurs between quota reservation and pending-row insertion, quota may conservatively over-count usage. To reconcile: disable uploads, wait for in-flight requests to stop, run the janitor, inspect pending/deleting records and private bucket objects, and remove any confirmed orphan objects. Then, while uploads remain disabled, reconcile the ledger with the comparison table:

```sql
UPDATE quota
SET used_bytes = COALESCE((SELECT SUM(bytes) FROM comparisons), 0),
    comparisons = (SELECT COUNT(*) FROM comparisons)
WHERE id = 1;
```

Do not blindly reconcile during live uploads. Never reduce the ledger below actual retained object storage. Resource deletion, bulk moderation, restoring backups, and migration rollback require a separate reviewed operator procedure.
