# Share Comparison: strict Free-only feasibility

Analysis date: **2026-10-30**. Audited `main`:
[`903c1d50ac7e6caf4b0782af218c184e1e43757f`](https://github.com/Kuba25x/upscale-compare/commit/903c1d50ac7e6caf4b0782af218c184e1e43757f),
including merged stages 1–7. This document is a feasibility investigation,
**not stage 8, a selected architecture, rollout approval or Free certification**.
The application, limits, database migrations, production lock and workflows are
unchanged. All experiments used local synthetic/public fixtures. No Cloudflare
resources, credentials, subscriptions, remote migrations or uploads were used.

The separately authorized [local storage and complete-codec follow-up](FREE_STORAGE_RESEARCH.md)
adds SQLite DO/KV prototypes, failure/consistency models and full-codec CPU/memory
evidence on 2026-10-31. This document retains its original measurements and verdict;
neither investigation authorizes stage 8 or a production architecture change.

The later [phase A/B execution comparison](FREE_VALIDATION_EXECUTION_RESEARCH.md)
adds public-limit questions and local workerd/Chromium job measurements on
2026-11-01. It does not resolve actual Browser Run resources or approve deployment.

## Decision

**The current Worker + D1 + R2 design does not meet the owner's combined
requirements for verified 10 ms CPU and guaranteed zero charges. Do not deploy it.**

- Local measurements give strong reasons to investigate a different execution
  model for large originals. Native CRC32 helps large PNG chunks, but does not
  remove the cost of inflating a 4K/8K PNG. Multipart parsing and SHA-256 are also
  substantial work. No edge CPU or peak isolate-memory measurements exist.
- Standard R2 includes usage, then bills overages. The public documentation
  reviewed establishes no provider-enforced zero-dollar stop. Application limits,
  an emergency switch, private buckets, caching and alerts cannot substitute for
  that protection. Optimizing validation does not fix this independent blocker.
- Current JPEG/WebP validation is structural, rather than a full codec decode.
  Two deliberately incomplete local files pass it and fail Pillow decoding.
  Fast structural WebP checks must not be presented as full validation evidence.
- A service using only provider-capped Free products is plausible at much lower
  capacity, with a new storage/validation design. It is **not implemented or
  proven**. KV and SQLite-backed Durable Objects merit local prototypes; their
  consistency, execution and storage limits materially change the design.

Recommendation: keep sharing closed; first approve a **local-only feasibility
prototype**, independently of stage 8. Compare Free SQLite Durable Objects and
KV, resolve the documented Durable Object CPU ambiguity described below, and
define complete format validation before choosing an architecture. Keep the
current local comparison experience and exact original file bytes. If this
research is too costly, retain local comparison or consider curated static
publication with an explicit reduction in functionality.

## 1. What the current request actually does

The relevant source at the audited commit is
[upload intake](../worker/src/upload.ts),
[publication routing](../worker/src/index.ts),
[format validation](../worker/src/image-validation.ts),
[fingerprints](../shared/publication.ts), and
[storage/recovery](../worker/src/publication-store.ts).

| Operation          | Actual behavior and resource implication                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admission          | D1 control/generation and rate checks precede intake. They can refuse work, but also consume rows/CPU. One active upload and two queued callers per isolate bound publication buffers, not all concurrent request memory.                                                |
| Receive multipart  | Allocate a single bounded body buffer, at most 40 MiB + 64 KiB. Unknown Content-Length reserves the configured maximum even for small requests. Copy each network chunk into it. File slices share that buffer.                                                          |
| Find boundaries    | JavaScript KMP scans binary payloads; headers, field counts and delimiter endings are bounded and checked. Linear complexity prevents pathological quadratic search, but still visits every file byte.                                                                   |
| Parse manifest     | Bounded JSON and Zod validation; two to four matching files. Small compared with large-file scans, but still part of the same CPU budget.                                                                                                                                |
| Fingerprint        | SHA-256 of each entire original, followed by hashing normalized JSON with ordered file hashes. Native WebCrypto is already used. Hex conversion handles only 32 digest bytes.                                                                                            |
| Retry/verification | Fingerprint lookup precedes Turnstile; a matching existing publication can recover without revalidation. New content must pass Siteverify. Thus new unauthenticated content currently incurs intake and hashing before challenge verification.                           |
| PNG                | CRC of every chunk, ordering/critical-chunk/palette/dimension/depth checks, animation/interlace restrictions, EXIF orientation checks; then full deflate expansion, exact raster-length and scanline-filter checks. Input pulls are at most 8 KiB; chunks at most 4,096. |
| JPEG               | Bounded marker/segment parsing, SOF/SOS/dimensions/EXIF checks, a JavaScript scan of entropy bytes through EOI. No full Huffman/DCT decoding.                                                                                                                            |
| WebP               | RIFF/chunk lengths and count, static VP8/VP8L header dimensions, VP8X agreement, animation/EXIF checks. Image payload is skipped by length; no complete VP8/VP8L decoding.                                                                                               |
| Store/activate     | Sequential original R2 PUTs, D1 pending ownership, quota accounting and generation fences, then activation. Recovery and cleanup preserve prior stages' invariants. No application re-encoding.                                                                          |

PNG's JavaScript output loop inspects scanline filter positions, **not every
decoded pixel**. Expensive expansion still occurs natively. A small encoded PNG
can therefore be more expensive than a much larger WebP container. File size,
pixel count, bit depth and structural complexity all need independent bounds.

The frontend also fingerprints selected Files for its private retry journal.
Moving server checks to that frontend would neither remove malicious uploads
nor establish that stored bytes are the validated bytes. CORS and Turnstile are
not trusted content validation.

### Validation completeness finding

The local diagnostic constructs a 27-byte JPEG containing SOF0/SOS/EOI but no
image tables/blocks, and a 26-byte WebP containing just a VP8L signature and
dimension header. **Both return 1 × 1 image metadata from `validateImage`; both
fail `Image.load()` in Pillow 12.3.0.** See the
[diagnostic](analysis/free-sharing-2026-10/check-codec-validation.mjs) and
[recorded results](analysis/free-sharing-2026-10/codec-validation-results.json).

This demonstrates incomplete codec validation, not code execution, malware or a
complete successful production publication. The browser's normal file-opening
checks cannot protect a server API called by a different client. Existing checks
must remain; a proposed complete validator must also reject incomplete encoded
payloads, have bounded CPU/memory and pass valid baseline/progressive/lossless
and metadata fixtures. PNG checks likewise should not be described as a universal
codec, metadata or malware audit: not every ancillary payload is interpreted.

No proposed optimization in this report removes checks, trusts client results,
changes original bytes, accepts animation, ignores orientation, or publishes
quarantined content. Adding a full decoder is a separate security and resource
requirement, not an assumed free operation.

## 2. Evidence collected locally

All new raw samples and documentary reproduction tools are in
[`docs/analysis/free-sharing-2026-10/`](analysis/free-sharing-2026-10/).
Inputs have encoded size and SHA-256 recorded. Original production source is
bundled into ignored scratch files; CRC alternatives exist only in those copies.

Environment: Node 24.19.0, V8 13.6.233.17-node.51, zlib
1.3.2.1-motley-3246f1b, Linux; Miniflare 5.20261023.0-beta / workerd
1.20261023.1. Codec stress fixtures use Pillow 12.3.0 and deterministic RGB noise.
These fixtures exercise valid codecs, **not representative game screenshots**.
Creating lossy JPEG/WebP test fixtures is unrelated to application uploads: no
user original is converted or proposed to be converted.

### Node component CPU

Five measured rounds after two untimed calls for each format-validation variant,
or one warm-up for isolated hash/CRC/multipart components; fixture construction
and explicit GC are outside timing. Values below are **median [minimum–maximum]
process CPU milliseconds**, not wall latency, edge CPU or statistical tails.

| Workload                                               |                Encoded bytes |    Current implementation |           Native-CRC copy |
| ------------------------------------------------------ | ---------------------------: | ------------------------: | ------------------------: |
| 4K RGB8 grid PNG                                       |                       36,218 |    45.493 [39.976–53.855] |    41.981 [36.709–44.981] |
| 4K RGBA8 zero PNG                                      |                       32,318 |    59.399 [45.210–59.804] |    47.805 [45.525–55.038] |
| 8K RGBA8 zero PNG                                      |                      129,067 | 188.857 [159.811–232.221] | 212.570 [184.718–237.037] |
| 8K RGBA16 zero PNG                                     |                      258,050 | 385.041 [356.423–411.785] | 473.037 [370.183–504.124] |
| 32 × 24 PNG, valid text padding to 20 MiB              |                   20,971,520 |    83.359 [82.004–88.337] |       6.724 [6.363–8.070] |
| 4K baseline JPEG noise                                 |                    4,232,768 |    17.598 [15.467–17.988] |              Not measured |
| 8K baseline JPEG noise                                 |                   16,931,313 |    26.992 [25.614–28.554] |              Not measured |
| 4K lossy WebP noise, structural validation             |                    4,614,770 |       0.050 [0.027–0.052] |              Not measured |
| 8K lossy WebP noise, structural validation             |                   18,540,450 |       0.018 [0.017–0.102] |              Not measured |
| SHA-256 alone, 20 MiB                                  |                   20,971,520 |    17.272 [15.425–19.139] |            Not applicable |
| Multipart alone, two 20 MiB binary parts, length known | 41,943,405 including framing | 163.315 [159.059–172.633] |              Not measured |
| Same multipart, length unknown                         |                         Same | 172.312 [158.349–175.869] |              Not measured |

The multipart binary parts are parser workloads, not valid images. Their parsed
length/endpoints are checked; no validation/store/Turnstile is included. SHA
timing uses the same native digest operation as the application; tiny hex/manifest
work is excluded. Source, variants and complete samples:
[Node](analysis/free-sharing-2026-10/node-results.json),
[large JPEG/WebP](analysis/free-sharing-2026-10/codec-results.json).

The isolated 20 MiB CRC medians were **80.565 ms** with the current `for…of`,
**50.270 ms** with an indexed loop, and **5.822 ms** with Node `zlib.crc32`.
IEEE test vector `123456789`, empty/random inputs, offset views and incremental
native CRC agreed in the recorded cases. This is promising compatibility
evidence, not an exhaustive equivalence proof or production replacement.

Native CRC does not consistently improve the raster-dominated cases. Small
sample size, fixed variant order, JIT/GC, process-wide native threads and shared
host scheduling preclude attributing those differences precisely. Do not add
component medians to predict provider CPU or infer p95/p99 from five rounds.
The previous stage-7 three-round observations remain historical evidence in
[Free-tier operations](FREE_TIER_OPERATIONS.md), not these new measurements.

### Local workerd compatibility and wall latency

The CRC-native scratch Worker used the existing compatibility date with explicit
`nodejs_compat`. Native CRC imported successfully, returned the IEEE vector and
rejected a corrupted PNG, as did the original copy. Three measured dispatches
after warm-up gave these **host round-trip wall milliseconds**:

| Input             | Current copy range | Native-CRC copy range |
| ----------------- | -----------------: | --------------------: |
| 4K RGB8 grid PNG  |      70.196–95.138 |         68.152–72.144 |
| 8K RGBA8 zero PNG |    339.792–424.608 |       376.058–397.915 |
| 20 MiB padded PNG |      75.455–93.012 |         33.637–41.088 |

These include emulator/IPC/request-body transfer. **They are not workerd CPU
measurements.** Local workerd accepting a request does not demonstrate 10 ms
enforcement or edge memory suitability. No peak isolate-memory values or actual
Cloudflare CPU data were obtained. See
[workerd samples](analysis/free-sharing-2026-10/workerd-results.json).

## 3. Memory and 4K/8K limits

Current 36,000,000-pixel and 16,384-side bounds admit 7680 × 4320 UHD 8K
(33,177,600 pixels), but not every image advertised as 8K, such as 8192 × 4608
(37,748,736 pixels). Encoded files must still fit 20 MiB each and 40 MiB total.
Keeping original quality permits rejecting an unsupported original intact; it
does not require every possible 8K file to fit the publication envelope.

Derived, uncompressed PNG scanline sizes, including one filter byte per row:

| Dimensions  |                           RGBA8 |                    RGBA16 |
| ----------- | ------------------------------: | ------------------------: |
| 3840 × 2160 |   33,179,760 bytes / 31.643 MiB |   66,357,360 / 63.283 MiB |
| 7680 × 4320 | 132,714,720 bytes / 126.567 MiB | 265,425,120 / 253.129 MiB |

These are amounts **processed**, not currently retained raster allocations.
The validator streams decompression and keeps filter/count state. It does not
allocate a 253 MiB decoded array. Conversely, backpressure and an 8 KiB input
pull do not prove a maximum native output queue, inflater memory, GC overlap or
digest-copy footprint. A compressed chunk can expand much more than 8 KiB.

An allocation model must include the approximately 40 MiB body, any request or
digest/native copies, JS/runtime/codec state, streamed outputs, active reads,
queued/rejected request objects, cleanup and transient garbage. One additional
40 MiB copy brings just those two buffers to approximately 80 MiB, before the
runtime. The upload semaphore is not a semaphore for public image reads or all
objects sharing an isolate. Sequential processing remains essential.

A full decoder that allocates RGBA for all of 8K consumes about 126.6 MiB for
that output alone, leaving no credible 128 MB isolate margin. Do not adopt it
with a 20 MiB input alongside it. A bounded scanline/tile codec validator would
need its own proof; progressive JPEG coefficient buffers and WebP decoder
internals cannot be assumed to have PNG's streaming footprint. The required
security scope may force format-specific publication limits even after CPU
is addressed. Local comparison limits need not change.

## 4. Optimization candidates under a strict 10 ms invocation budget

[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
specify 100,000 requests/day, 10 ms CPU, 128 MB/isolate, 50 subrequests and six
simultaneous outgoing connections on Free. This investigation conservatively
keeps the project's 50-call ceiling across all bindings and failure paths.
Waiting for I/O is different from CPU. A promise, stream, `await`, timer,
`waitUntil()` or several sequential files inside one invocation does not grant
a fresh CPU allowance. Occasional runtime flexibility is not engineering margin.

| Candidate                                       | Benefit and remaining problem                                                                                                                                             | Security/verification needed                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native IEEE CRC32                               | Large local improvement for a padded 20 MiB PNG. Does not remove inflate, multipart or hashing work.                                                                      | `node:zlib` is not enabled in current production compatibility settings. Verify CRC polynomial, incremental/unsigned/view semantics, malformed chunks and no fallback to a slower unexpected polyfill. Local import success is recorded. |
| Indexed JS CRC / slicing-by-N / WASM CRC        | Avoid iterator overhead or use wider operations. Indexed loop helped locally, yet remained far above 10 ms for 20 MiB. Other variants unmeasured.                         | Differential/fuzz tests, endian/offset handling; never use CRC32C in place of PNG CRC32. WASM is not intrinsically faster.                                                                                                               |
| Native byte search for multipart/JPEG           | `Buffer.indexOf` or an audited native/WASM scanner could avoid JavaScript per-byte work. Not benchmarked here.                                                            | Preserve delimiter suffix checks, near matches, offsets, truncation, stuffing/restart markers and worst-case bounds. Avoid repeated whole-buffer copies.                                                                                 |
| Streaming multipart + server digest             | Can reduce body allocation/copies and overlap I/O. `crypto.DigestStream` does not retain its input. Does not remove total digest/parser CPU or grant extra CPU time.      | Preserve bounded headers/fields, original byte ordering, cancellation, deadlines, aggregate limits and backpressure; avoid an unbounded `tee()` queue.                                                                                   |
| Verification earlier for new intents            | Reduce work done for unverified attempts. Normal retry already has a private result-recovery API. Does not make legitimate full uploads cheaper by itself.                | Distinguish a known intent before moving verification. Never return an active success for a changed body; preserve fingerprint conflicts, token freshness and stop-generation fences.                                                    |
| Tune PNG stream/codec implementation            | Native inflater buffering or a bounded alternative may reduce queue/async overhead. Larger input pulls could increase memory and attack exposure. No speedup established. | Full deflate integrity, declared output bound, filters, CRC, cancellation, backpressure and malformed-stream tests must pass. Never use `inflateSync` into a whole 8K raster as the quick fix.                                           |
| Smaller accepted byte/pixel/depth/chunk profile | Reject costly originals unchanged. Potentially enough for a limited pilot after measurements.                                                                             | Byte-only limits miss small compressed bombs; dimension-only limits miss metadata. No numeric Free-safe envelope has been established. Restricting 8K/16-bit/progressive content is an owner decision.                                   |

The [Workers zlib documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/)
describes the compatibility requirement; this repository uses `2026-07-01`
without `nodejs_compat`. Do not silently change compatibility dates/flags as part
of a documentation analysis. The
[DigestStream contract](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
offers streaming hashing, not portable export/import of unfinished hash state.

**Assessment:** optimizing only CRC is insufficient. A single complete
publication containing large 4K/8K originals cannot currently be approved for
10 ms with margin. Local results do not prove it impossible on every Cloudflare
runtime, but they do not support promising that a small refactor will solve it.
Suggested future acceptance targets remain p99 <= 5 ms, all observed CPU < 8 ms,
peak isolate memory <= 96 MB and <= 44 calls, with explicit safety reserves.
These are proposed engineering targets, not current configuration or guarantees.

## 5. Staging without weakening validation

Dividing a 40 MiB upload into requests is insufficient if a final request still
hashes or inflates everything. A real strict-10-ms design needs bounded work and
durable, authenticated state **for each operation**, including invalid inputs.

1. Admit a private intent after verification; reserve bytes, attempts, chunk
   operations and cleanup headroom globally. Pin manifest, owner capability,
   expected sizes, ordered images and publishing generation. Do not accept
   arbitrary storage keys or use the client digest as authority.
2. Receive bounded ordered original-byte ranges. Enforce exact offsets, total
   bytes, per-part deadlines and limited concurrent sessions. Duplicate identical
   parts are idempotent; conflicting overlaps are rejected. Quarantine is private.
3. Validate incrementally with versioned, server-owned checkpoints: SHA-256 state
   (including partial block and length), CRC/chunk state, parser bounds and PNG
   inflater dictionary/bit/Huffman state, Adler checksum, decoded count and filter
   position. Limit **decoded output work**, not just compressed input bytes.
4. Resume only an authenticated server checkpoint, atomically advanced by a
   generation/sequence fence. Recheck output limits before excessive work. A native
   DecompressionStream or DigestStream cannot simply be serialized between
   invocations. A live object can be evicted; restarting from byte zero on every
   part defeats bounded work and can become quadratic.
5. Complete all codec checks and the exact original fingerprint before activation.
   The reviewed manifest/order/dimensions/MIME and stored bytes must be bound
   together. Late parts or an emergency stop must never reactivate old sessions.
   Original bytes can be stored as ordered segments and streamed back exactly;
   a mandatory final 20 MiB concatenation/hash is not a valid staged solution.
6. Recover interruption, takeover and ambiguous writes; keep unvalidated parts
   inaccessible. Bound abandoned-session cleanup, checkpoint retention and
   janitor CPU separately. Crash after every durable mutation must be testable.

The native streams expose no documented portable inflater/hash checkpoint API.
A resumable audited WASM decoder/hash with exportable state is one hypothesis;
serializing undocumented V8/native internals is not an acceptable design.
Deflate's bounded history helps, but code, checkpoint size, corruption resistance
and full format semantics still require substantial implementation and review.
JPEG progressive/WebP checkpoints need separate codec designs. Client validation
plus a checksum, random partial checks and skipping raster expansion do not meet
the security requirement.

An illustrative 256 KiB input part yields 160 parts for 40 MiB. At a hypothetical
1 MiB **decoded** step, an 8K RGBA16 raster needs at least 254 output steps; that
step size is not measured safe. A budget formula must count both input and output
steps, retries, checkpoint reads/writes, verification, activation and reclamation:

`attempts/day × (intake + validation + finalize + polling + cleanup + retry requests) + all viewer/admin/other requests <= account Free allowance`.

For KV quarantine, 160 part writes plus two final original writes already use
162 of 1,000 daily writes, before checkpoints/retries. Six maximum attempts
consume 972 writes and leave essentially no safe reserve; rejected attempts also
count. Retaining segmented originals avoids final copies but increases viewer
reads and cleanup. Neither number is a recommended quota. A redesign must choose
a work unit from edge measurements and model the entire lifecycle, not advertise
unlimited sharing because each invocation is short.

Service bindings/queues/workflows also need their actual invocation and quota
rules checked. Recursion or artificially resetting CPU through asynchronous
callbacks is not a supported substitute for a bounded state machine. No staged
prototype, serializable codec or edge test was implemented in this analysis.

## 6. R2: what would and would not guarantee $0

As checked on 2026-10-30, [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
includes Standard storage of 10 GB-month, 1 million Class A and 10 million Class B
operations/month. Excess Standard usage is priced at $0.015/GB-month,
$4.50/million Class A and $0.36/million Class B, with billing-unit rounding.
Internet egress and object deletion are free. Infrequent Access does not have
the Standard included range. Storage uses averaged daily peaks, not merely the
application's current live-image ledger.

[R2 getting started](https://developers.cloudflare.com/r2/get-started/) requires
a subscription checkout and describes monthly usage billing.
[Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
notify; they do not suspend usage. No public R2 setting establishing a hard $0
cap was found in the reviewed pricing/setup/billing documentation. This is the
documented standard-service conclusion, not a claim about hypothetical private
contracts. An undocumented dashboard assumption is insufficient to lift the lock.

| Approach                                                                          | Strict zero-charge status                                                                | Practical implications                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do not activate/use R2; remain local                                              | No R2 consumption or overage exposure from this application.                             | Existing comparison still works; no persistent hosted share links.                                                                                                                        |
| Use R2 within small application limits                                            | **Risk reduction only.**                                                                 | Does not cap account billing, other clients, control-plane calls, retries or physical orphan storage.                                                                                     |
| Alert at $0/$1, daily usage polling, automatic stop                               | **Risk reduction only.**                                                                 | Delayed metrics/notifications and in-flight work can exceed included usage before response. Alert minimum thresholds are irrelevant to whether usage stops.                               |
| Private bucket, no public URL, rate limits, Turnstile, CDN                        | **Risk reduction only.**                                                                 | Helpful attack controls; do not cap bills. CDN misses/evictions, direct authorized operations and stored data remain.                                                                     |
| Disable uploads/revoke credentials/remove routes                                  | **Risk reduction only.**                                                                 | Does not erase already billed operations, daily peaks or retained data. Reads/storage can continue after publishing stops. Worker bindings are not disabled merely by revoking an S3 key. |
| Remove payment method, rely on payment failure, promotional credits               | **No supported guarantee.**                                                              | Do not use debt/payment failure as a cost-control design. Credits expire or have scope restrictions.                                                                                      |
| Provider contract/configuration that refuses all usage before any billable excess | Could qualify only with verified binding terms and complete metering coverage.           | No such R2 protection is established here. Do not assume it exists or activate R2 to look for it.                                                                                         |
| Replace R2 with Free-plan hard-failing storage                                    | Removes this R2 overage path; provider Free quotas cap that alternative's service usage. | Different capacity/consistency/availability. Requires account remaining on Free, no paid add-ons and owner-approved resource setup; no statement about unrelated account charges.         |

Authenticated failed operations can also consume R2 usage; success counts are
not a billing meter. Retries, staging, HEAD/LIST/backup/operator work and other
applications share the allowance. Ten GB is not ten GiB. Storage can continue to
accrue while publishing is stopped. Deletion does not undo past daily peaks.
See [existing monitoring/stop procedures](FREE_TIER_OPERATIONS.md) for useful
controls, with their explicit non-guarantee. No single finite operational reserve
proves zero cost without an enforced maximum across all billable paths.

## 7. Architectural alternatives

### A. Free Workers KV originals + D1 control plane

The [KV Free pricing contract](https://developers.cloudflare.com/kv/platform/pricing/)
states 100,000 reads/day, 1,000 writes/day, 1,000 deletes/day, 1,000 lists/day and
1 GB stored. Over-limit operations fail on Workers Free; operational quotas reset
at midnight UTC, while stored data does not disappear at midnight.
[KV limits](https://developers.cloudflare.com/kv/platform/limits/) allow values
up to 25 MiB, enough for a current 20 MiB original, and one write/second/key.

Advantages: dynamic binary storage without R2 subscription; unmodified files;
simple one-key-per-immutable-image retrieval using
[`get(key, 'stream')`](https://developers.cloudflare.com/kv/api/read-key-value-pairs/)
rather than buffering each read. Retain D1 for strong visibility, ownership,
generation/quota control and original comparison manifests.

Disadvantages: 1 GB is a **total** shared storage ceiling, less than 24 full
40 MiB comparisons before staging, overhead and safety reserve. This cannot
retain the current nominal 5 GiB image allocation. Quarantine/checkpoints may
consume writes very quickly. KV does not provide R2-style conditional/head/list
and recovery semantics as a drop-in replacement.

[KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
is eventual: updates and negative-cache entries may take 60 seconds or more to
propagate, and immediate local visibility is not guaranteed. A successful PUT
cannot certify immediate worldwide opening. Use immutable random/versioned keys,
bounded pending/retry responses and explicit missing-object handling. Never put
authoritative takedown/quota/locks in KV. Every read must first pass a fresh
strong D1 visibility gate, without stale/public-cache or alternate-host bypass;
logical deletion can then refuse new reads while physical KV deletion propagates.
In-flight downloads and previously downloaded copies remain separate privacy limits.

This solves the **R2 billing category**, not the 10 ms validator problem. Staging
or a separately qualified executor is still necessary. Privacy/availability and
smaller retention/storage require owner agreement. Local Miniflare cannot prove
global propagation or real provider quota enforcement.

### B. SQLite-backed Durable Objects on Workers Free

[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
explicitly offers SQLite-backed objects on Free and says over-limit operations
fail. The published envelope includes 100,000 requests/day, 13,000 GB-s/day,
5 million rows read/day, 100,000 written/day and 5 GB storage. Duration is active
**wall time**, including non-hibernatable waiting, with 128 MB accounted per
object even when actual use is smaller. These numbers are not an invitation to
enable a paid plan. Treat D1 and DO meters separately; the documentation describes
matching row allowances, not proof of a single combined counter.

Important unresolved CPU interpretation:
[DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
list 30 seconds default CPU per request and describe reset semantics, but also
refer to Workers' plan-dependent limits and the same per-invocation limits. The
general Workers table says Free is 10 ms. **Do not infer a confirmed 30-second
Free entitlement or use it to bypass the owner's explicit 10 ms constraint.**
Get a plan-specific authoritative clarification, then explicit owner agreement
on whether that service-specific execution model would be acceptable, before
any edge experiment or architecture decision. Local workerd cannot settle the
account entitlement. No `cpu_ms` increase is proposed or applied.

If the service-specific allowance is confirmed and accepted, a thin Free Worker
could stream the body to a DO, which performs bounded full validation before
activation, with durable retry ownership. This could avoid expensive serialized
inflater checkpoints. That is a hypothesis, not a measured Free architecture.
The outer Worker still needs to fit 10 ms, including proxy/security overhead.
If strict 10 ms is required in every executor, use DO only for coordination or
storage and retain the staged-validation problem.

SQLite BLOB segments below the documented 2 MB row limit can retain original
files without R2/KV and avoid KV propagation issues. Stream their concatenation
in order, with one validation fingerprint for the entire original; never expose
arbitrary segment keys. The limit page's general table and Free per-object
storage explanation differ; use the conservative **1 GB/object** bound until
clarified, with 5 GB account-wide, and reserve space for staging/schema/indexes.
Do not build a plan around a 10 GB Free object.

Advantages: serialized ownership and transactional local state; dynamic originals;
stronger storage semantics; published Free failure instead of overage. Existing
D1 control-plane fences can be retained initially rather than rebuilding all
control logic at once.

Costs/tradeoffs: substantial storage adapter, streaming and lifecycle work; no
R2 API equivalence; rows/indexes/delete/alarm usage; whole-object hot spots;
128 MB shared isolate memory remains. Slow clients and pending I/O consume
duration, so deadlines and concurrency limits matter even with little CPU.
Multiple objects may share an isolate, so a per-object upload semaphore alone
cannot certify memory. Exhausted daily write allowance may also prevent cleanup
and alarm scheduling. Keep owner/admin emergency refusal independent of storage
and reserve lifecycle capacity. Default native decoders still may not fit 8K RAM.

### C. Curated immutable originals in Workers Static Assets

[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
documents free static requests and no additional asset-storage charge. Free
Workers asset limits are currently 20,000 files/version and 25 MiB/file, covering
the current individual file bound. These are deployment assets, not a runtime
anonymous PUT store.

A trusted operator validates originals offline, stores exact bytes as private
deployment assets with their manifest, and publishes through a controlled build.
No R2 subscription or runtime codec CPU is needed. A fresh D1 check plus correctly
configured `run_worker_first` on **every image/manifest path** can gate visibility;
Free request exhaustion on matched paths returns 429 instead of exposing assets
as a fallback. All aliases, previews, worker URLs, caching and prior versions need
equivalent access controls. Do not assume assets are private by default.

Tradeoffs: removes instant public publication; submissions require a separately
designed safe channel, trusted review and deployment. Physical deletion/version
retention and rollback can differ from current takedown semantics. Build minutes,
storage of source images and domain costs must be reviewed independently. Never
place personal originals in public Git history or put a deploy token in a browser.
This is a reduced-functionality option requiring explicit owner selection.

### D. Other options and exclusions

- An offline comparison package/download containing originals and settings has no
  hosted image-storage bill but loses a persistent public link. A 40 MiB payload
  encoded in a URL is not a practical substitute.
- D1 BLOB segments have provider-capped Free billing, but 500 MB/database,
  2,000,000 bytes/row, query/serialization and lifecycle overhead make D1 a poor
  default image store. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
  It still does not solve codec CPU. Do not shard databases merely to imply
  unlimited Free storage.
- Peer-to-peer or owner-provided external storage can remove this account's R2
  use, but introduces availability, recipient-IP disclosure, mutable URLs,
  cross-origin and cost-transfer concerns. Remote URLs or client checks alone
  do not preserve validated immutable originals and current privacy semantics.
- A pre-existing trusted external validator could sign a result over exact bytes
  and the manifest, with strict replay/version binding. Hosting it somewhere else
  does not prove zero total cost; opening a signature service to anonymous uploads
  recreates abuse/capacity issues. No such infrastructure exists in this project.

| Option                          | Provider-enforced $0 path for project storage                   | Large-original validation                                                 | Main compromise                                           |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Current R2, optimized           | No documented hard stop                                         | Still unproven at 10 ms                                                   | Does not meet strict requirements                         |
| KV Free + staged validator      | Yes, while account remains Free and uses only included products | Complex, unproven resumable codec                                         | ~1 GB, low write quota, eventual availability             |
| SQLite DO Free storage/executor | Yes under documented Free product rules                         | Conditional on CPU clarification, owner constraint and memory/codec proof | New execution/storage design and hard outages at quota    |
| Curated Static Assets           | No R2 bill; documented asset storage/request pricing            | Trusted offline validation                                                | Delayed/operator publication, retention/deletion redesign |
| Local/offline package           | No cloud image storage                                          | Local only                                                                | No persistent hosted link                                 |

The Free-product entries concern **those product usage charges**, not domain
purchases, other account products, future plan changes or guaranteed uptime.
Hard quota failure protects billing by sacrificing availability. No paid fallback,
automatic upgrade or R2 spillover belongs in a zero-cost design.

## 8. Verification that can be authorized separately

### Already performed without paid services

- Read/synchronized current `origin/main`, reviewed actual source and stage-7
  safeguards; consulted the public official documents linked above.
- Five-round Node component diagnostics, including actual large JPEG/WebP codec
  fixtures; CRC comparison and local workerd compatibility/wall-time checks.
- Incomplete JPEG/WebP acceptance versus Pillow decoding, as described above.
- Existing image-validation and upload unit suites: **63 tests passed**. This
  is targeted validation; the stage-7 full suite is not claimed as rerun here.

Reproduction from the repository root, with existing npm dependencies installed:

```bash
node --expose-gc docs/analysis/free-sharing-2026-10/probe.mjs
node docs/analysis/free-sharing-2026-10/probe-workerd.mjs
# Optional codec workload dependency: Python + Pillow (12.3.0 used).
python docs/analysis/free-sharing-2026-10/generate-codec-fixtures.py
node --expose-gc docs/analysis/free-sharing-2026-10/probe.mjs --formats-only
node docs/analysis/free-sharing-2026-10/check-codec-validation.mjs
npx vitest run tests/unit/image-validation.test.ts tests/unit/upload.test.ts
```

All output goes to ignored `.wrangler/feasibility/`; scripts never publish or
contact Cloudflare. The workerd probe opens local emulator connections only.
The recorded Pillow comparison can be reproduced with
`Image.open(path).load()` on each generated `incomplete-codec.*` file. No fixture
or timer threshold is a CI admission certificate. Archived JSON is a historical
run, not overwritten by the reproduction commands.

### Useful next local work, not implemented by this PR

1. Define complete validation semantics for each supported format; add regression
   cases for incomplete codecs. Evaluate vetted bounded decoders, metadata,
   orientation and memory before implementation selection. Differential/fuzz
   tests must include corruption, truncation, giant expansion and segment floods.
2. Prototype native CRC/search/stream intake in scratch copies, compare exact
   original hashes, preserve every parser rejection invariant and test hostile
   boundary near matches. Record whole local HTTP paths without treating latency
   as provider CPU. Benchmark actual owner screenshots when available.
3. Compare KV and SQLite DO adapters locally: exact 2/3/4-image round trips,
   retry ownership, every crash point, stop during parts/validation/activation,
   cleanup failure, quota exhaustion and recovery, no access to quarantine,
   HTTP HEAD/GET and restored comparison state. Inject eventual KV visibility;
   an emulator's immediate read-after-write cannot establish global behavior.
4. If strict staging is still needed, prove one portable server checkpoint can
   resume an adversarial PNG without replaying the prefix and bound both input
   and output work. Do this before building a public multipart-session API.
   Extend to complete JPEG/WebP or reject the design as incomplete.
5. Model rows/bytes/requests for successful and rejected lifecycles, including
   janitor, polling, reads, delete and other account applications. Reserve capacity
   for recovery/admin/deletion; local API-call counts are not provider row meters.

### Requires separate explicit owner approval

Nothing in this analysis authorizes these operations:

1. A private Cloudflare **Free-only, no-R2 component probe**, using an approved
   immutable code/fixture set, no personal images, capped request counts and
   verified free metric collection. Record actual CPU/outcomes including cold,
   warm, malformed, maximal, concurrent and abort paths. Keep production blocked.
2. Creating Free KV/DO/D1 resources or namespaces and performing bounded remote
   writes/SQL/migrations to verify quotas, consistency, CPU entitlement and
   physical cleanup. First inspect the actual account plan and other usage;
   do not activate a subscription or product that can produce charges.
3. Any edge full-flow Turnstile setup, DNS/domain choice, resources, live
   screenshots, monitoring or test traffic. Native/WASM CPU attribution and
   native memory behavior cannot be certified by Node or Miniflare.
4. Any request to consider R2 despite absent hard protection. Under the current
   zero-charge requirement the recommendation is **do not activate R2**, even
   for a small full-flow experiment. An R2 emulator is sufficient for old-design
   functional regression work; it cannot prove billing protection.

Measure actual distributions over a predeclared adequate sample count and load
matrix; five local observations do not establish p99. Include all maintenance,
read/retry/failure paths and aggregate account usage. If peak isolate evidence is
unavailable, record it as unknown; absence of termination in a small run is not
a memory certificate. Proposed 5/8 ms, 96 MB and 44-call targets require owner
acceptance. Metrics dashboards may be delayed, sampled or insufficient; do not
enable chargeable logging to fill that gap without separate approval.

On [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/), monitor
actual rows read/written, including indexes/triggers and scans, against the
5 million/100,000 daily envelope and storage limits. A small SQL query count is
not a row budget. Free exhaustion can remove both service and application admin
functions. Preserve a fail-closed edge stop that does not need D1, and distinguish
"stop publication" from "stop serving/retaining data". These are availability
controls even when provider Free caps make billing overage impossible.

## 9. Decisions for the owner

| Decision                                                             | Recommendation                                                                                                                         | Dependency/tradeoff                                                                                                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep guaranteed zero project usage charges?                          | Yes; keep R2 inactive and no Workers Paid fallback.                                                                                    | Requires replacing R2 or reducing sharing functionality.                                                                                                                                               |
| Authorize next research scope?                                       | Local-only format-validation and Free KV/DO prototype first, independently of stage 8.                                                 | New code needs a separately approved implementation scope and PR; no deployment lock change.                                                                                                           |
| Must every executor stay within 10 ms?                               | Keep the current constraint unless an authoritative Free DO interpretation and explicit owner decision allow a service-specific model. | The 30-second DO table is not accepted as entitlement here. This choice determines whether portable staged codecs are necessary.                                                                       |
| Accept lower storage/publication capacity?                           | A small, measured library with refused uploads at capacity; no auto-delete policy invented here.                                       | KV ~1 GB versus conservative sharded Free DO storage; reserve staging/admin space. Owner chooses retention and scale after modeling.                                                                   |
| Keep immediate anonymous Share Comparison?                           | Prefer retaining it as a research goal, without promising feasibility.                                                                 | KV propagation and staged progress may require a pending state; curated assets remove instant publication.                                                                                             |
| Accept smaller format-specific limits if complete codecs cannot fit? | Decide only after actual codec resource evidence.                                                                                      | Preserve bytes and local comparison; reject unsupported originals clearly. May exclude 8K/16-bit/progressive files from sharing.                                                                       |
| Approve private edge measurements later?                             | Only after the local design is credible and the actual Free account/product/counter setup is reviewed.                                 | Separate authorization, tightly bounded traffic, no R2 activation or production publication.                                                                                                           |
| Provide real screenshot acceptance data?                             | Optional non-sensitive originals plus expected dimensions/bit depth/color profile and saved comparison settings.                       | Locally test representative 4K/8K PNG/JPEG/WebP, alpha/HDR/16-bit and odd dimensions; do not send private metadata unnecessarily. Physical-device tests address display/restoration, not provider CPU. |

There is no approved full-function deployment path with the current R2 billing
model and unverified 10 ms validator. A Free-only redesigned service may retain
original quality and public links with smaller capacity and quota outages; its
full validation and resource suitability still need proof. If unchanged instant
publication, all currently admitted large originals, existing retention/consistency,
strict 10 ms everywhere, complete codec validation and guaranteed $0 all remain
non-negotiable, feasibility is **not established**. Do not promise it or progress
to stage 8 on these results. No security check or original-image quality reduction
is recommended as a shortcut.
