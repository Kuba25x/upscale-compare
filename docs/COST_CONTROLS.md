# Cost controls and emergency publishing stop

Stage 4 adds migration `0004_cost_controls.sql`. No resources, plans, live budgets,
notifications or public uploads are activated by this change.

## Closed defaults and accounting

The migration initializes `service_control` with publishing paused and **all seven
daily limits set to zero**. Zero disables the corresponding admission; it never
means unlimited or a positive fallback. Missing control state or failed D1 checks
fail closed. Existing manifests, keys, storage reservations and cleanup markers
are preserved. Original files are not transformed and active comparisons do not
expire automatically.

All isolates share one D1 policy and indexed `daily_usage` rows keyed by UTC date.
Atomic conditional UPSERTs prevent concurrent admissions from exceeding limits.
The day is a fixed UTC calendar day, not a rolling window; traffic can burst on
both sides of midnight. Limits are integers in `[0, Number.MAX_SAFE_INTEGER]`.
Existing environment limits also reject malformed/unsafe values; an explicit zero
is respected rather than replaced with an allowance.

| Policy field            | Counter and charging point                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `max_upload_attempts`   | `upload_attempts`: before body reading, verification or validation                                              |
| `max_upload_bytes`      | `upload_bytes`: full body capacity reserved with that admission                                                 |
| `max_publications`      | `publications`: new pending reservations, including later failed publications                                   |
| `max_publication_bytes` | `publication_bytes`: original bytes reserved with the pending row                                               |
| `max_read_requests`     | `read_requests`: public manifest, preview and image GET/HEAD requests, including unknown IDs and per-IP denials |
| `max_image_reads`       | `image_reads`: immediately before R2 GET/HEAD, including later failures                                         |
| `max_image_bytes`       | `image_bytes`: full original response size before GET; HEAD reserves zero bytes                                 |

Upload capacity is the validated `Content-Length`, or the configured aggregate
image ceiling plus 64 KiB multipart overhead when length is unknown. The same
reader enforces that capacity. Unknown-length uploads can consume a whole
40 MiB + 64 KiB reservation even for small files. Reservations are never refunded
after cancellation, validation/verification failure, storage failure, deletion or
an ambiguous acknowledgement. This is deliberately conservative accepted-work
accounting, not measured network traffic or provider billing. Rejected/mismatched
bodies may already have reached the transport before cancellation.

New pending insertion, daily publication charging, the stage-2 storage ledger and
the stage-3 retry marker share a D1 transaction. A rejected daily reservation
rolls all of them back; deletion cannot recycle a daily allowance. Matching
operation retries do not charge another publication reservation, but resending
their body still consumes upload admission. Use private result checks instead.

Public read admission precedes per-IP writes and lookup/R2 work. Once a global
limit is reached, further matching requests make only their D1 admission check,
without incrementing per-IP counters or touching R2. Exhausted per-IP counters
also stop incrementing. R2 HEAD uses `head()`, not a GET with a discarded body.
GET verifies the stored object's size matches the reserved manifest size before
exposing its stream. Range/conditional requests still reserve a whole original;
no partial response or cache bypass is added.

Health, private publication-result recovery, authenticated deletion, operator
controls and scheduled maintenance are outside these daily public-read limits.
Their existing authorization/per-IP controls remain. This preserves recovery and
removal during a stop or public-read exhaustion, but those paths still cost
Worker/D1 operations. Provider/edge protection must cover them too.

Aggregate daily rows are kept for 35 days, then purged in indexed batches of at
most 100 per hourly run. Outages/backlog can extend retention. A retention failure
does not block independent comparison cleanup. A full worst-case maintenance
batch uses at most 44 D1/R2 API calls, including the new retention call; internal
SQL trigger/index work is additional database work, not separate binding calls.

## Emergency stop and restart

There are two independent publishing gates: `UPLOADS_ENABLED=true` on the Worker
and an unpaused D1 control with nonzero remaining publication/admission budgets.
The production generator leaves the Worker flag false. Health reflects the
current policy/day availability without exposing counters; it is informational,
and every publication still performs authoritative admission.

The operator can call `POST /api/admin/publishing/stop` using
`Authorization: Bearer <ADMIN_TOKEN>`. Use a secret-aware API client; never put
the key in URLs, browser JavaScript, public reports or command history. No body is
needed. It persistently sets paused and increments `generation` in one D1 write,
without redeployment. Repeating the stop is safe, including after a lost response.
`GET /api/admin/costs`, with the same authorization, returns private control,
current UTC usage and storage-quota information with `no-store`. It is an
operational view, not an account bill or a transactionally frozen billing report.

Admission captures the current generation. The Worker rechecks it after receiving
the body and before each original write. Database triggers fence pending INSERT
and activation against the current unpaused generation. Once the stop commits,
an older writer cannot newly activate, even after restart. Comparisons active
before the stop stay public subject to read budgets. Recovery, deletion and
cleanup continue.

An admitted body, validation work or an already-issued R2 operation can still
finish; D1 cannot atomically cancel network work in R2. A stop between a state
check and a PUT can leave that PUT in flight. Activation is denied and stage-2
compensation/janitor recovery handles remnants. Do not interpret the response as
proof that all in-flight CPU/I/O or physical cleanup has ended.

If the HTTP endpoint is broken but D1 is reachable, use the reviewed
[`worker/emergency-stop.sql`](../worker/emergency-stop.sql) through the operator's
D1 console/CLI. If D1 or its account allowance is unavailable, that fallback also
cannot run: block the API hostname/paths at the edge or disable/remove the Worker
route through Cloudflare. Disable every alternate workers.dev/preview route as
well. An application-level stop cannot prevent already-billable incoming requests.
Local image comparison remains available independently of the API.

There is **no HTTP resume/reset endpoint**. Before a separately authorized restart:

1. Confirm the stop through the private status endpoint or D1. Inspect provider
   usage, daily counters, active/reserved storage and cleanup/expiry backlog.
2. Identify the cause, apply edge/rate protections, reconcile retained objects
   only using the stage-2 guarded procedure, and obtain approved limits/plan.
3. Update the chosen D1 limits while paused. Keep the ledger intact; restarting
   or raising a budget must not erase previously charged work.
4. Increment generation and set `publishing_paused=0` only after review. Keep or
   enable the Worker flag separately, as authorized. Never reset generation to
   an earlier value. Old admissions remain fenced; use fresh client actions.

## Budget options for the owner

These are recommendations for a future approved beta, **not applied settings or
authorizations for paid services**. The PR keeps all production daily limits zero.
Choose the first profile for initial observation and raise limits only after
measuring real workloads. Byte/count limits are independent: the first reached
limit wins, so the count is not a promise of that many maximum-size publications.

| Daily allowance                  | Small closed beta (recommended) | Larger beta |
| -------------------------------- | ------------------------------: | ----------: |
| Upload attempts                  |                              20 |         100 |
| Body reservation bytes           |                         512 MiB |       2 GiB |
| Pending publication reservations |                               5 |          20 |
| Original publication bytes       |                         100 MiB |     500 MiB |
| Public read requests             |                           2,000 |      10,000 |
| R2 image GET/HEAD operations     |                           1,000 |       5,000 |
| Original response bytes          |                           2 GiB |      10 GiB |

For the smaller beta, also consider lowering the existing environment storage
ceiling to 1 GiB and comparison count to 100; neither recommendation is applied
to production here. Active images are permanent, so eventually full storage stops
publishing rather than silently deleting users' content. Low admission limits can
be intentionally exhausted by attackers, denying legitimate publishers for that
day. Edge controls and operator monitoring are necessary for availability.

Do not approve a dollar budget solely from these numbers. Workers Free's CPU
limit can reject large screenshots; local success does not establish suitability.
Keep uploads disabled until an approved provider benchmark determines whether
lower image limits suffice or a Paid plan merits a separate decision. A paid
subscription and any billable R2 activation require the owner's explicit approval.

## Provider prices and hard limits checked on 2026-10-28

| Service        | Official allowance/pricing relevant here                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workers Free   | 100,000 requests/day; 10 ms HTTP CPU/invocation                                                                                                                             |
| Workers Paid   | Minimum $5/account/month; 10 million requests and 30 million CPU ms/month included, then $0.30/million requests and $0.02/million CPU ms                                    |
| R2 Standard    | 10 GB-month, 1 million Class A and 10 million Class B operations/month included; excess $0.015/GB-month, $4.50/million A, $0.36/million B; Internet egress and deletes free |
| D1 Free        | 5 million rows read/day, 100,000 rows written/day, 5 GB total storage; queries fail after exhausted daily allowances                                                        |
| D1 Paid        | 25 billion reads and 50 million writes/month, 5 GB included; excess $0.001/million reads, $1/million writes, $0.75/GB-month                                                 |
| Turnstile Free | Unlimited challenges/verification requests, 20 widgets, 10 hostnames/widget                                                                                                 |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[Turnstile plans](https://developers.cloudflare.com/turnstile/plans/).
Allowances are account-wide/shared with other usage; provider rounding and plan
terms apply. The application's byte reservations are not invoice units.

Incoming/denied requests, the checks themselves, exempt paths, database indexes,
triggers, logs/backups, other applications and already-in-flight work can still
incur costs. R2 egress being free does not make its GET operations or Workers
invocations free. Configure provider usage notifications and billing alerts,
monitor CPU, D1 row metrics, R2 storage/operations, daily admission exhaustion and
failed maintenance. [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
are informational and do **not** pause or cap spending; they can arrive after usage.
This implementation cannot guarantee a hard account-wide dollar ceiling.
The shared daily row is also a serialized write hotspot; local concurrent tests
do not establish production throughput or D1 availability under attack.

The production generator disables workers.dev, preview URLs and Worker
observability, leaving custom routes to a later approved configuration so an
unprotected alternate hostname does not bypass edge rules. On an already approved
Paid account, explicitly supplying `APPROVED_PAID_CPU_MS` (integer 1–1000) adds a
per-invocation CPU cap; no cap/plan override is generated by default. Free uses its
provider limit. This input neither selects nor activates a plan. Verify the actual
account plan before deployment and choose any paid CPU cap from real measurements;
the code does not choose a suitable paid budget for the owner.

## Migration and local verification

Apply 0004 only in an approved maintenance/drain/backup window after 0001–0003.
Configure approved read limits before restoring existing public readers: the
initial zeros also close public reads. Old pending rows cannot activate across
the migration fence, and old Worker writers without a generation are rejected;
existing active rows and deletion/cleanup remain intact. An older Worker can
bypass application read accounting, so do not blindly roll back. Follow the
[stage-2 precautions](PUBLICATION_RECOVERY.md#migration-and-rollback).

For local development only, run `npm run db:local`, then `npm run costs:local`
before `npm run dev:api`. The latter applies generous test allowances and resumes
only the local emulator; it accepts only an optional `--persist-to` directory and
always passes `--local`. Never apply `worker/local-controls.sql` to production.
Browser/API suites use isolated local state and explicit test policy setup.

Tests exercise real local D1/R2 atomicity and faults; new HTTP fault tests invoke
the real handler in Node with those storage bindings. Existing workerd tests also
exercise the budgeted publication/read path and 40 MiB byte identity. No new
CPU/memory benchmark, real billing margin, provider outage/replication behavior,
edge rule deployment or live notification delivery is established by local tests.
