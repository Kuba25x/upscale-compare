# Guarded production operations

Stage 7 prepares procedures and an explicit **blocked** release state from `main`
`92d079c` (stages 1–6). There is no production deployment in this stage. The owner
requires zero Cloudflare charges: Workers Free, D1 Free and included R2 Standard
usage only. [Free-tier evidence and blockers](FREE_TIER_OPERATIONS.md) take
precedence over earlier paid-plan suggestions and beta capacity examples.

## Current safeguards

- `ops/production-readiness.json` records the policy and unresolved findings.
  `npm run ops:check` is read-only and intentionally fails. No environment variable,
  confirmation, JSON `ready` edit or CLI override unlocks it; resolution requires
  a reviewed code change and evidence. This is a repository release lock, not a
  Cloudflare account billing cap or protection against an administrator using
  Wrangler/the dashboard independently.
- Both manual production workflows require `main` and run the lock before
  installs/tests/remote actions. The Pages demo branch remains usable with its
  existing explicit `DEPLOY` confirmation. Neither PRs nor pushes deploy.
- The backend workflow no longer applies remote D1 migrations automatically.
  Schema changes require their own reviewed maintenance authorization. When the
  release lock is eventually resolved, deployment still requires a schema-compatible
  release and explicit approval; typing `DEPLOY` now cannot bypass the lock.
- Production config preparation is offline. It refuses paid CPU overrides and
  emits no plan selection, routes, workers.dev/preview exposure, Worker logs,
  uploads or cron. Existing image ceilings are not certified Free-safe. The D1
  policy still starts paused with zero daily allowances. Local emulation is separate.
- R2 remains private; no public bucket/r2.dev, S3 client upload, unvalidated public
  object or cache route may bypass D1 visibility and budgets. Original quality,
  security checks, recovery/deletion and owner capability separation are retained.

## Decisions the owner must record

These decisions are pending. Recommendations do not apply settings or grant
permission. The dollar budget is already **zero**; do not substitute a paid tier.

| Decision                                  | Recommendation                                                                                             | Evidence/action needed from owner                                                                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend/API hostname                     | Keep existing Pages demo; for a future API reuse an already owned Cloudflare Free-zone hostname            | Exact origins/base path, DNS/zone owner and Free edge controls; do not buy a domain or expose workers.dev as a shortcut                                                              |
| Cloudflare account/resources              | Verify Free account and residual allowances, isolate project resources from unrelated usage where possible | Confirm other Workers/databases/buckets, account/resource IDs, location/jurisdiction, access roles and lack of paid add-ons; no creation yet                                         |
| R2 activation and zero-overage protection | Keep R2 unactivated until an enforceable zero-charge arrangement exists                                    | Owner verifies subscription terms and protection with provider; billing alerts alone do not satisfy the requirement; separate activation approval is mandatory                       |
| Supported publication sizes/traffic       | Keep budgets zero; derive a small pilot only from the resource matrix                                      | Approve byte/pixel/count/concurrency capacity and conservative account-wide D1/R2 reserves after measurements; no numeric production limits selected here                            |
| Active-image retention                    | Explicitly choose permanent-until-delete versus a clearly disclosed fixed lifetime                         | Current behavior is permanent until deletion. A 7/30-day pilot lifetime is an option, but needs separate implementation/consent/tests before adoption                                |
| Backups and recovery targets              | Consider limited encrypted operator-held snapshots instead of another R2 bucket                            | Choose RPO/RTO, location/access, expiry, deletion propagation and restore drills; reserve export/restore operations and storage without paid backup activation                       |
| Privacy/moderation responsibility         | Publish operator identity and security/privacy/abuse contact before accepting images                       | Decide response owner, availability, provider data location/policies and retention of provider logs; no contact/address is invented by the project                                   |
| Monitoring and emergency operator         | Use reviewed free aggregate dashboards and an operator who can disable routes without D1                   | Select recipients, review frequency, free alert capability, response time, account backup access/2FA and manual drills                                                               |
| Real acceptance and rollout               | Remain closed until source/device and Free-resource evidence passes                                        | Supply [stage-6 assets/device acceptance](ORIGINAL_FIDELITY.md#real-screenshot-and-physical-device-acceptance); approve immutable release SHA and a later limited rollout separately |

## Local rehearsal available now

```bash
npm run build
npm test
npm run test:e2e
npm run test:sharing:local
npm run test:demo
npm run probe:resources:local
npm run ops:check  # expected exit 1: production remains blocked
```

No Cloudflare account is needed. The diagnostic is offline; sharing verification
is replaced only by test transports. Run normal local migrations/bootstrap only
against local emulation as described in README. Never copy `worker/local-controls.sql`
to production. Do not interpret a successful local check as account authorization.

`worker/operations-status.sql` contains read-only aggregates for policy, current
UTC admissions, reserved/retained row bytes/counts, due cleanup and expired
rate/retry backlog. Its integration test checks unchanged data and absence of
manifests, capabilities and network identifiers. Diagnostic COUNT/SUM queries may
scan tables; use a planned row-usage window, not per-request/polling execution.
It cannot inventory physical R2 orphans or prove provider usage. No remote
execution wrapper or new public diagnostics endpoint is provided.

## Future approved maintenance and deployment sequence

This is a procedure to review, not an executable authorization. At present the
Free/R2 blockers prevent proceeding to resource creation or deployment.

1. **Owner records go/no-go.** Resolve every decision above, verify actual Free
   plans and zero-overage enforcement, and approve a specific immutable commit,
   maintenance window and resource IDs. Recheck official limits and dependencies.
   Keep production uploads, public reads/routes and cron closed for first setup.
2. **Access and isolation.** Use 2FA and separate least-privilege deployment,
   operator, read-only monitoring and backup credentials. Keep secrets in an
   approved secret manager/protected GitHub environment. No secrets in Vite,
   files, URLs, logs, screenshots, command history or public Issues. Audit who can
   edit workflows/environments and approve production; use environment required
   reviewers and branch protections when available. Do not invent a broad token
   if the account cannot scope permissions sufficiently.
3. **Review package locally.** Build/test; create the disabled config with dummy
   or approved IDs using `scripts/prepare-production.mjs`. A Wrangler dry-run is
   packaging evidence only. Verify exact frontend origin, API hostname, private
   bucket, no alternate/public routes, logs/cron/uploads off and schema compatibility.
4. **Drain before schema work.** Persist the publishing stop, block public routes
   at the edge as appropriate, and prevent owner/admin deletion, old cron and
   writers during a schema maintenance window. A publishing stop alone does not
   stop delete/cleanup writers. Wait for admitted intake and in-flight writes;
   the 120-second reader deadline is not proof that remote R2 operations ended.
   Follow [recovery migration precautions](PUBLICATION_RECOVERY.md#migration-and-rollback).
5. **Backup and distinct migration approval.** Capture reviewed schema/migration
   state, private D1 export and an object inventory under the approved retention
   plan. Verify a restore locally and record ledger/deletion state. Apply only the
   reviewed pending migrations to the confirmed remote D1 after a **separate
   explicit authorization**; this PR supplies no remote migration workflow.
   Inspect the actual migration ledger; repository test helpers do not stand in
   for Wrangler's production ledger. Partial migration failure keeps routes closed.
6. **Deploy disabled code only after release unlock.** Review package hash and
   environment binding IDs again. The future manual workflow deploys code only;
   it does not create resources, choose plans, set secrets, run migrations or
   open hostnames. Set/rotate narrowly scoped Turnstile/admin secrets through a
   secret-aware tool only when separately authorized. Initial D1 daily limits
   remain zero/paused, so existing readers also need explicit allowances.
7. **Private smoke and resource acceptance.** Under approved bounded access and
   usage, verify real verification host/action, allowed/disallowed origins,
   unchanged original hashes, manifest/view/refresh, key backup, lost-response
   recovery, owner/admin deletion, cleanup faults and generation fences. Measure
   the full Free envelope and shutdown path; restore a backup in isolation.
8. **Separate opening decision.** Owner approves final capacities, published
   privacy/retention/contact notice, monitoring, retention schedule and the exact
   hostname/edge rules. Resume D1 with a new generation and enable the upload flag
   only in the separately authorized rollout. Enabling cron is another reviewed
   resource/retention decision, not an automatic side effect of deployment.

## Emergency actions

| Incident                                                                                      | Immediate action                                                                                                                                 | Verification before restart                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Abuse, validation errors or upload pressure                                                   | Persist `POST /api/admin/publishing/stop` with a private admin capability, then restrict publishing at edge                                      | Confirm paused/new generation, failed activation of older admissions, correct existing-link behavior                                  |
| D1 exhausted/unavailable, CPU/memory failures, total Free headroom unknown or R2 overage risk | Block **all API paths** at the edge/disable the Worker route using account access; close every alternate hostname and suspend cron/other clients | Verify that new public requests are blocked and scheduled/other writers are suspended; investigate in-flight work independently of D1 |
| Private key/admin/Turnstile secret exposure                                                   | Stop/restrict access, rotate the affected secret and review scope                                                                                | Confirm old credentials no longer authorize; restore only necessary capabilities; never publish the leaked value                      |
| Incomplete writes, orphan objects or quota drift                                              | Keep publishing stopped; preserve deletion markers/reservations; use bounded recovery when capacity allows                                       | Reconcile actual objects, pending/deleting/active rows and quota in a maintenance window                                              |
| Incorrect image exposure or deletion request                                                  | Restrict affected links/API as needed, use owner/admin removal, record unresolved storage cleanup                                                | Check public manifest, preview and every original independently; browser copies and third-party caches cannot be recalled             |

The stop endpoint and `worker/emergency-stop.sql` are documented in
[cost controls](COST_CONTROLS.md#emergency-stop-and-restart). Keep credentials out
of shell history; use a secret-aware client. D1 SQL fallback cannot work when D1
itself is exhausted. Blocking only POST does not stop GET/HEAD costs. Disabling a
route must not expose an alternate unprotected origin; verify fail-closed routing.
Already issued CPU/I/O may finish, and stored data continues consuming storage
while routes are blocked. Do not assume DNS propagation is an immediate stop.
Keep local comparison/demo available independently.

## Restart, restore and rollback

- Restart is a new owner decision after reviewing provider totals, measured peak
  workload, counter/retention backlog, abuse protection and remaining period
  headroom. Do not clear daily usage, refund failed work or reset generations.
  Increment generation; old admissions stay fenced. Midnight alone is not a safe
  restart rule, especially for monthly R2 or unresolved data integrity problems.
- Roll back **code only** when it is compatible with the current schema and
  preserves retry markers, generation fences, quotas and read budgets. An older
  pre-stage-4 Worker can bypass them. Keep the API closed if compatibility is
  unknown. No automatic down-migration or blind previous-version deployment.
- D1 Free has a [seven-day Time Travel window](https://developers.cloudflare.com/d1/platform/limits/),
  which is not a coordinated R2 backup or a deletion/retention policy. A restore
  can revive deleted manifests and private authorization hashes. Restore in
  isolation, reapply deletion/takedown records, verify byte hashes and ledger,
  then separately approve publication. Do not overwrite live data automatically.
- Object listings/export/restore and extra backup copies consume operation/storage
  allowance. Deletion can be free in R2 Standard while retention or restore still
  incurs usage. Reserve capacity and choose backup scope/expiry before execution.
- Record incident timestamps, commit/schema IDs, aggregate counts, actions and
  unknowns privately. Redact images, metadata, credentials, full URLs and network
  identifiers. No automatic email/Slack notification or paid logging service is
  configured by this stage.
