# Free-only resource and cost envelope

Checked against official documentation on **2026-10-29**. The owner requires
Workers Free, D1 Free, R2 Standard's included usage and **zero charges**. Workers
Paid and R2 overages are not acceptable fallbacks. This is a design constraint,
not permission to activate R2, provision a resource or perform an edge probe.

**Current verdict: production sharing is blocked.** Functional local success
from stages 1–6 does not certify the Free resource envelope or zero-overage R2.
`npm run ops:check` intentionally exits 1. Both production workflows invoke that
lock before installs, tests or remote actions; the Pages demo can still be
published through its existing explicit manual authorization.

## Provider envelope

| Service/resource     | Free constraint                                                    | Failure/billing implication                                                                  |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Workers requests     | 100,000 per UTC day, shared account allowance                      | Exhaustion refuses requests; choose fail-closed routes, never an origin bypass               |
| Worker CPU           | 10 ms per HTTP **and scheduled** invocation                        | CPU termination is possible; asynchronous I/O waiting is different from CPU                  |
| Worker memory        | 128 MB per **isolate**, shared by concurrent requests              | Buffer bounds alone do not prove runtime/native/stream memory margin                         |
| Subrequests          | Design for at most 50 total calls per invocation                   | Include D1/R2, verification and failures; do not rely on a higher internal-service allowance |
| Outgoing connections | 6 awaiting headers per invocation                                  | Preserve sequential writes/cleanup and avoid unbounded fan-out                               |
| D1 daily rows        | 5,000,000 read; 100,000 written; resets 00:00 UTC                  | Free exhaustion rejects queries, including stop, recovery and deletion                       |
| D1 storage           | 500 MB per database; 5 GB across Free databases                    | Tables and indexes count; quota ledger of image bytes is unrelated                           |
| R2 Standard storage  | 10 GB-month included                                               | Averaged **daily peak** stored data; deleting later does not undo past peaks                 |
| R2 operations        | 1,000,000 Class A; 10,000,000 Class B per month                    | Included allowance is not a spending cap; excess can be billed                               |
| R2 egress/deletes    | Internet egress and object deletion are free                       | GET/HEAD and uploads still consume operations; other products may cost money                 |
| Turnstile Free       | 20 widgets, 10 hostnames/widget; unlimited challenges/verification | Real hostname/key/account setup still needs verification                                     |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing/row accounting](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Turnstile plans](https://developers.cloudflare.com/turnstile/plans/).
Recheck before any future approval. Storage units labeled GB by the provider
must not silently be treated as a larger GiB allowance.

R2 requires an [R2 subscription/checkout](https://developers.cloudflare.com/r2/get-started/).
Its Standard free range can be exceeded and billed; Infrequent Access has no
such included range. [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
notify after a spending threshold and **do not stop usage**. No provider hard
zero-spend setting is established by the documentation checked here. Removing a
payment method, an alert, a small bucket or an application counter is not evidence
of a zero-overage arrangement. Do not activate R2 under the present authorization.

## Current architecture and blockers

- Multipart receiving buffers up to 40 MiB + 64 KiB, with one active publication
  and two waiting callers per isolate. Fingerprinting, PNG CRCs/decompression and
  validation add CPU/native allocations. Even a small compressed 8K PNG expands
  to a large raster. Lowering only compressed byte size cannot solve this.
- The janitor has 10 comparison candidates plus retention. Its Free CPU limit is
  still 10 ms. Bounded API call count is useful but does not establish CPU, memory
  or D1 row costs. Rate-row retention is now limited to 100 expired rows per run;
  a backlog can grow if expiry arrival exceeds cleanup throughput.
- Stage-4 counters cover admitted application work, not every invocation or
  provider row/operation. Rejected admission, health, OPTIONS, private recovery,
  owner/admin deletion and maintenance consume resources too. Indexes, triggers,
  retries, diagnostics, migrations, other projects and manual storage tools add
  usage. There is no current account-wide R2 monthly meter or hard billing cap.
- D1 exhaustion can disable the application stop endpoint and janitor together.
  The edge/route shutdown must work without Worker execution or D1 access.
- Current production limits are closed configuration defaults, **not approved
  Free-safe publishing limits**. Production cron is now generated empty until its
  resource/retention behavior is approved. No active-image TTL is introduced.

## Repeatable local evidence

```bash
npm run probe:resources:local
npm test
npm run test:sharing:local
```

The first command has no network or provider target. It bundles the actual image
validator and fingerprint hash into an offline Node component diagnostic, with
three generated inputs and three rounds each. JSON output is ignored at
`.wrangler/operations/local-resource-report.json`. It reports process CPU and
before/after process memory, **not peak isolate memory or full HTTP edge CPU**.
Fixture construction is outside the measurement; first-use/runtime effects and
machine scheduling still affect results. Timing is not a CI pass/fail threshold.

One local Node 24 run on 2026-10-29 measured:

| Generated PNG                                  | Encoded bytes | Validation Node CPU (3 rounds, ms) | Hash Node CPU (ms)     |
| ---------------------------------------------- | ------------: | ---------------------------------- | ---------------------- |
| 3840 × 2160 RGB grid                           |        36,218 | 107.977, 77.315, 60.545            | 9.645, 0.257, 0.297    |
| 7680 × 4320 zero RGBA raster                   |       129,067 | 294.839, 237.671, 255.600          | 0.401, 0.316, 0.336    |
| 32 × 24 RGBA with valid ancillary text padding |    20,971,520 | 80.436, 80.693, 83.185             | 17.777, 18.309, 14.331 |

These observations show substantial work in both high-pixel/small-file and
large-file cases; they do not convert into Cloudflare CPU measurements. They
justify withholding approval, not a claim that a specific lower limit is safe.
Memory snapshots include Node/input/runtime allocations and cannot certify 128 MB.

Integration checks meter real local D1/R2 **binding calls**, counting a D1 batch
as one API call. Four-file success/failure/ambiguous-activation paths reserve one
additional call for production verification and remain below 50. Full janitor
success and fault paths remain at most 44 calls including retention/recovery.
Siteverify uses manual redirect handling and rejects 3xx, avoiding a redirect
chain. SQL trigger/index work and provider internal retries are not extra calls
seen by this meter, but can add row usage and cost. This is not an edge benchmark.

## Required real-resource verification plan

No step below is authorized to execute in stage 7. Resolve billing/account access
first; stop if a resource, subscription, probe or monitoring feature can charge.
Use generated public fixtures and a reviewed immutable commit; no personal images,
credentials in URLs, production test endpoints or production verification bypass.

1. **Inventory and baseline.** Owner records the actual Workers/D1 plan, all other
   account usage, R2 subscription/billing period/classes/buckets, D1 sizes and
   remaining daily/monthly headroom. An unused project does not imply an unused
   account. Confirm how the proposed zero-overage protection is enforced.
2. **CPU screening without R2.** If separately approved, a private Free-only
   component probe can measure multipart parsing, hashing, Zod, CRC/decompression
   and rejection on generated files before an R2 subscription is considered.
   This can disqualify a profile, not certify the full storage pipeline.
3. **Full production path.** Only after the zero-charge R2 blocker is resolved,
   measure the actual protected Free Worker with real D1/R2 and Turnstile. Include
   cold/warm success, invalid content, maximum 2/3/4-file forms, unknown lengths,
   aborted intake, duplicate/recovery, activation/cleanup faults, public GET/HEAD,
   missing IDs, delete/admin/health/OPTIONS, all retention batches and cron.
4. **Matrix and concurrency.** Sweep file sizes (128 KiB through 20 MiB), pixel
   counts (small through 4K/8K), PNG depths/alpha/fragmentation, JPEG/WebP and
   near-limit metadata. Include simultaneous reads with 1 active + 2 queued
   publications, extra rejected callers and concurrent cleanup. Capture CPU
   p50/p95/p99/max, outcomes, subrequests, native/heap/buffer evidence and failures.
5. **Acceptance proposal, owner approval required.** Aim for CPU p99 <= 5 ms and
   every measured invocation < 8 ms, peak isolate use <= 96 MB and <= 44 calls,
   leaving headroom under 10 ms/128 MB/50. If peak memory evidence is unavailable,
   record it as unknown, not a pass. Any resource termination fails the profile.
   Verify per-query `rows_read`/`rows_written` including indexes/triggers under
   production D1; local query counts cannot substitute for those measurements.
6. **Record and retest.** Keep the commit/runtime/plan, encoded size/dimensions,
   cases, sample count, distributions, failure counts, concurrency, cost envelope
   and remaining unknowns in a de-identified report. Repeat after relevant parser,
   codec/runtime, schema/index or budget changes. Unlocking needs a reviewed code
   change, resolved owner decisions and separate rollout approval, not a flag.

## Account-wide monitoring and stop plan

Use provider aggregate dashboards first, with read-only credentials if programmatic
polling is later approved. Never poll the image endpoint as a health check.
Suggested review triggers below are proposals, not live settings:

| Signal                           | Evidence and recommended reaction                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker CPU/memory/subrequests    | Review resource outcomes plus p95/p99/max on each bounded probe; any exceededCpu/exceededMemory or near-limit invocation blocks expansion and stops uploads      |
| Worker requests                  | Sum all account Workers, including rejected/exempt traffic; warn at 50%, stop at 75% or sooner if projected exhaustion precedes next review                      |
| D1 rows/storage                  | Use actual row metrics, not query counts; same 50%/75% review/stop proposals, with separate reserve for cleanup, deletion, migrations and diagnostics            |
| R2 A/B/storage                   | Use billing-period account totals plus all buckets, other clients and daily storage peaks; stop new PUT/GET work well before remaining allowance can be consumed |
| Cleanup/retention                | Monitor due rows, earliest due time, failures, reserved/retained drift and expired rate/retry backlog; a growing backlog blocks publishing                       |
| Monitoring delay or missing data | Treat as unknown; keep closed or stop, rather than assuming zero usage                                                                                           |

References: [Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/),
[D1 row metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/),
[R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/).
Metrics may be delayed/sampled. Keep Worker observability/log storage off by
default; select a verified free aggregate source and privacy policy before adding
logs, Tail Workers, Logpush or another service. Do not assume those products are free.

Reserve at least `maximum observed consumption rate × (metric lag + polling
interval + shutdown response time)` plus in-flight operations and maintenance
headroom. There is no proven maximum attack rate at the application gate, so
this formula alone cannot certify a hard zero bill. Edge protections must cover
all API paths and alternate hostnames; monitor externally, and test the manual
edge shutdown while D1 is unavailable.

For a conditional small-beta proposal from stage 4, modeled upper bounds include
`4 × admitted upload attempts × UTC dates intersecting the billing period` Class A
PUT calls and `image-read admissions × intersecting UTC dates` Class B calls,
**plus** carry-over writers, provider retries, operator/list/backup/migration work
and other clients. A 31-day cycle starting inside a UTC day can touch 32 UTC dates;
D1 daily reset is not a monthly R2 reset. At 20 attempts and 1,000 image reads/day,
32 dates yield 2,560 PUT calls and 32,000 GET/HEAD calls before those extras. This
is a planning example, not applied quotas, a measured bill or complete accounting.
Storage must include physical orphan/in-flight/backup objects, not just the ledger.

## Free-only alternatives if the gates cannot pass

Recommended immediate option: retain the Pages demo, local comparison and closed
sharing. No quality/security reduction or paid plan is needed to keep that useful.

For a future design decision, consider a **measured smaller publication envelope**
(byte/pixel/chunk/image-count limits) that rejects unsupported originals intact;
local comparison can retain current limits. Do not silently resize/recompress or
remove PNG/verification/security checks. This might exclude real 4K/8K workflows.

Keeping large originals may require a substantial **staged, bounded validation
protocol** across invocations: private quarantine, resumable server-side hashes/
CRC/decompression state, ordered parts, full validation before activation, abuse
quotas, cleanup and atomic retry semantics. Its D1/R2 overhead must also fit Free;
a client checksum or Turnstile is not trusted content validation. An alternative
is an operator-curated publication workflow with a different trust model. Neither
redesign is implemented or selected here. Do not treat chunking as a proven fix
or switch to Workers Paid to bypass the problem. Stage 8 is not started.
None of these alternatives by itself establishes a zero-overage R2 arrangement;
the billing blocker must be resolved independently.
