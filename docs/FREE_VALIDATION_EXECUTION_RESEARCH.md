# Free validation execution: phases A and B

**2026-11-01**, based on `main`
[`07d83b6ddaa5bb361d339c94a6ad20b6bcc5b8ca`](https://github.com/Kuba25x/upscale-compare/commit/07d83b6ddaa5bb361d339c94a6ad20b6bcc5b8ca).
This separately authorized investigation implements only public-documentation
review and local synthetic experiments. **Phases C, D, E and audit stage 8 were
not started.** No Cloudflare account, resource, subscription, remote binding,
provider measurement, migration, deployment or public upload was used. No message
was sent to Cloudflare. Production code, dependencies, configuration, security
controls and the deployment lock remain unchanged.

The prior [feasibility](FREE_SHARING_FEASIBILITY.md) and
[storage/codec](FREE_STORAGE_RESEARCH.md) reports remain historical evidence.
New executable research, reproduction instructions and unsent questions are in
[`research/free-sharing/execution/`](../research/free-sharing/execution/README.md).

## Recommendation and decision

**The trusted-browser execution direction is worth clarifying with Cloudflare;
it is not qualified for deployment or remote testing by this PR.** Local Chromium
can run the existing PNG checks and strict JPEG/WebP decode candidate for the
tested 4K/8K workloads while preserving original bytes. This offers a potential
way to reuse existing codecs rather than immediately building a custom validator.

The investigation does **not** establish that Browser Run Free has enough RAM,
permits the same data path, has equivalent startup/CPU behavior, or can reliably
fit the intended workload into its small daily allowance. Ordinary local
Chromium is not the actual service or its local binding emulator.

The current 8K full-RGBA wrappers remain unsuitable inside a 128 MB Worker/DO:
moving the same work into a browser does not reduce their allocation. It changes
the execution environment, whose actual allocation is still unknown. SQLite DO
remains only a candidate original-byte store; no production migration is justified
on these results alone. The existing R2 zero-overage and operational blockers
have not been resolved or bypassed.

**Stop after this report and PR.** The next decision belongs to the owner: obtain
the missing plan-specific answers, then decide whether a separately authorized,
small private Free measurement is worthwhile. Do not begin that measurement,
rewrite codecs or migrate production storage automatically.

## A. What public documentation establishes

The evidence register distinguishes documented facts, ambiguous statements and
unestablished facts:
[documentation register](../research/free-sharing/execution-results/documentation.json).
Public pages were read; actual account settings and remaining allowance were not.

| Subject                              | Classification  | Conclusion                                                                                                                                         |
| ------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker CPU/RAM                       | Documented      | Free HTTP has 10 ms CPU and 128 MB/isolate including WASM.                                                                                         |
| SQLite DO CPU on Free                | Ambiguous       | The DO default/reset table says 30 seconds; the introduction/FAQ also refer to Workers limits. An explicit Free entitlement remains unestablished. |
| Browser Run Free allowance           | Documented      | 600 browser seconds/day, shared across methods; three concurrent sessions/account and one new browser/20 seconds.                                  |
| Exhausted Browser Run Free allowance | Documented      | Further browser creation returns 429 until the next UTC day. This is not an observed account test.                                                 |
| Browser numeric RAM/CPU allocation   | Not established | No authoritative numeric Free browser allocation was found in the reviewed pages/searches. It is not assumed to exceed the tested workload.        |
| Actual account billing/activation    | Not verified    | Public Free availability does not verify the owner's plan, paid add-ons, other usage or activation requirements.                                   |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[DO FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/),
[Browser Run limits](https://developers.cloudflare.com/browser-run/limits/),
[Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/).
The favorable DO CPU interpretation is not assumed. Published Free limits are
not a certification of this application or permission to enable an account product.

### Session lifetime and the daily allowance

Browser Run's default 60-second timeout is an **inactivity** timeout, not a
60-second maximum active task. Unclosed sessions continue consuming browser time.
The launch-rate restriction also matters: the local warm-session measurements
do not simulate it or establish queue latency. Keeping a browser idle between
infrequent pilot publications can spend much more time than decoding the files.

The pricing documentation describes a timeout billing exception for Quick
Actions. It must not be assumed to exempt failed Browser Sessions. Exact startup,
failure, uncertain-close and ongoing-session behavior still needs clarification.
Sources: [limits](https://developers.cloudflare.com/browser-run/limits/),
[pricing](https://developers.cloudflare.com/browser-run/pricing/).

### Local parity and privacy

The [Browser FAQ](https://developers.cloudflare.com/browser-run/faq/) reports a
1 MB local-development request limitation. This experiment deliberately uses
ordinary local Playwright, not a remote binding to work around it. A successful
20 MiB localhost page fetch does not establish the actual binding/service path.

The same FAQ describes ephemeral submitted HTML/generated-output processing and
no caching for Browser Sessions, with exceptions for optional recording and crawl.
Those statements are useful but do not explicitly settle all binary-image/WASM,
failure or crash-diagnostic retention questions. No recording, crawl, trace, video,
HAR or screenshot collection is used in this experiment.

### Precise unanswered questions

[The complete unsent question set](../research/free-sharing/execution/CLOUDFLARE_QUESTIONS.md)
covers:

1. Free DO CPU by HTTP/RPC/alarm and its relationship to the caller Worker.
2. Numeric Free browser RAM/CPU, shared-process memory and support for the proposed
   custom binary/WASM validation workload.
3. The actual 20 MiB private page-fetch path versus binding/CDP payload and local
   emulation limits, including authentication and outbound restrictions.
4. Free refusal/billing rules, startup/wait/failure/close metering, ongoing sessions
   at quota exhaustion and free Session metrics.
5. Coverage of binary images in privacy/retention policies and, for future storage,
   SQLite backup/deletion/restore behavior.

No favorable answer, account inspection or provider contact is claimed.

## B. Local experiment design

### The two paths

The same unchanged production content checks and previously researched strict
full JPEG/WebP decode candidate run in:

- **Local workerd:** a standalone local Worker handler, with static compiled WASM
  imports. This is a compute experiment, not a new DO actor/storage integration.
- **Local Chromium/Playwright:** a trusted code page fetches binary originals
  directly from a private loopback fixture server, validates and hashes them,
  and returns small receipts. No original or decoded raster is sent through a
  large JSON/CDP argument. Uploaded bytes are never treated as HTML or scripts.

The fixture controller pins the manifest, job identity, ordered file hashes,
sizes, MIME and dimensions. It accepts local completion only when all receipts
agree. This is an in-memory research coordinator, not a public receipt API or a
replacement for D1/DO fencing. A real service must never trust a receipt supplied
by an arbitrary client.

Files run sequentially. Chromium uses a context per job and a fresh page per file.
Cold jobs launch and close an owned browser; warm jobs reuse a browser while
closing their contexts. Timeout, explicit cancellation, lost context-close
acknowledgment and browser disappearance fail closed. The 30-second local work
deadline does not prove a remote hard wall-clock cutoff; cleanup can add time.

The server binds only to loopback. Per-job capabilities protect originals, failed
jobs lose source access, CSP and route restrictions block external requests, and
a non-listening loopback proxy prevents browser background external networking.
Chromium is launched with `--no-sandbox` as required by the managed local setup;
this is synthetic-only testing, not proof of provider sandbox/isolation security.

### Workload and timing method

Eighteen workload cases cover:

- 4K/8K PNG, 8-bit and 16-bit, grid/zero rasters, and large high-entropy IDATs.
- PNG ancillary padding to exactly 20 MiB/file, with a 40 MiB pair.
- Baseline/progressive JPEG and lossy/lossless-alpha WebP at 4K/8K.
- A four-image exact-40-MiB PNG control and an ordered four-codec small control.

High-entropy PNGs are 18,757,430 bytes (4K RGB8) and 16,854,273 bytes (8K gray8).
They supplement the separate high-expansion/low-encoded-size cases. Fixture
generation uses deterministic noise, grids or constants; these are not real
screenshots or proof of representative content distribution. Lossy encoding only
generates test inputs and does not change an application original.

Each case/runtime has one cold measurement and five warm measurements after one
omitted warm-up: **216 recorded jobs**, including **108 local browser jobs**.
Homogeneous two-image cases intentionally repeat a synthetic original; the mixed
control and identity tests cover ordering. Original-byte SHA-256 is checked
before/after validation and against the controller's pinned specification.

Packaging/fixture preparation is outside execution timers for both paths. Browser
cold time includes process launch, contexts/pages, binary fetch, codec load/init,
hashing, validation, receipt verification and closing. Warm time excludes browser
launch/final close. Workerd cold includes emulator/runtime startup; per-file host
dispatch includes local IPC/body transfer. These are **different local paths**,
not directly comparable provider latency or Cloudflare CPU samples.

The timed job starts with originals already available in the synthetic private
source. User upload, D1/DO persistence, Turnstile, the actual Worker broker, public
opening, distributed cleanup and real network latency are absent. Controller
descriptor preparation is recorded separately. No production full-flow claim
is made.

## Results

| Synthetic job                | Browser cold / warm median (s) | workerd cold / warm median (s) | workerd research result                      |
| ---------------------------- | ------------------------------ | ------------------------------ | -------------------------------------------- |
| `4k-png8-grid`               | 1.156 / 0.868                  | 0.310 / 0.151                  | Content checks passed                        |
| `8k-png8-zero`               | 1.737 / 1.404                  | 0.801 / 0.749                  | Content checks passed                        |
| `4k-png16-zero`              | 1.430 / 1.126                  | 0.462 / 0.345                  | Content checks passed                        |
| `8k-png16-zero`              | 2.440 / 2.073                  | 1.570 / 1.350                  | Content checks passed                        |
| `4k-png8-noise`              | 1.558 / 1.299                  | 0.916 / 0.518                  | Content checks passed                        |
| `8k-png8-noise`              | 1.555 / 1.232                  | 0.775 / 0.591                  | Content checks passed                        |
| `4k-baseline.jpg`            | 1.399 / 1.135                  | 0.551 / 0.383                  | Content checks passed                        |
| `4k-lossless-alpha.webp`     | 1.254 / 0.858                  | 0.214 / 0.097                  | Content checks passed                        |
| `4k-lossy.webp`              | 1.899 / 1.705                  | 1.007 / 0.826                  | Content checks passed                        |
| `4k-progressive.jpg`         | 1.663 / 1.358                  | 0.455 / 0.309                  | Profile refusal, not a successful validation |
| `8k-baseline.jpg`            | 2.433 / 2.535                  | 0.194 / 0.071                  | Profile refusal, not a successful validation |
| `8k-lossless-alpha.webp`     | 1.586 / 1.196                  | 0.118 / 0.001                  | Profile refusal, not a successful validation |
| `8k-lossy.webp`              | 4.172 / 4.034                  | 0.168 / 0.059                  | Profile refusal, not a successful validation |
| `8k-progressive.jpg`         | 3.406 / 3.223                  | 0.206 / 0.065                  | Profile refusal, not a successful validation |
| `4k-png8-grid-20mib`         | 1.726 / 1.462                  | 0.813 / 0.351                  | Content checks passed                        |
| `8k-png8-zero-20mib`         | 2.361 / 2.035                  | 1.386 / 0.921                  | Content checks passed                        |
| `four-4k-png-exact-40mib`    | 2.627 / 2.404                  | 0.861 / 0.517                  | Content checks passed                        |
| `four-mixed-small-originals` | 1.647 / 1.361                  | 0.126 / 0.011                  | Content checks passed                        |

Times are seconds per whole local validation job. Warm values are medians of five
samples. Complete raw observations, minimums/maximums and phase timers are in
[summary](../research/free-sharing/execution-results/summary.json),
[JSON Lines samples](../research/free-sharing/execution-results/samples.jsonl) and
[fixture catalog](../research/free-sharing/execution-results/fixtures.json).
One cold observation is not a cold-start distribution; no p95/p99 or throughput
certificate is inferred from these small shared-host samples.

### Memory and CPU interpretation

The full-codec minimum sums original encoded bytes, WASM linear memory and a
distinct JavaScript RGBA output copy. For 8K the tested wrappers still need about
279–392 MiB **per file**, before runtime/native/transient allocations. Sequential
pages avoid intentionally retaining two decoded images, but do not establish
the whole browser-process peak or service memory reclamation.

For PNG, the retained lower bound records the encoded bytes only; native inflater,
stream queues and runtime peak are unknown. The validator processes the full
raster, including about 253 MiB of scanline data for an 8K RGBA16 zero input,
without intentionally allocating that entire raster at once.

The local workerd research profile refuses known 8K two-copy allocations before
decoding, and refuses a 4K progressive case after observing a lower bound above
the proposed 96 MiB safety profile. The latter is **not safe pre-allocation
admission**. Neither a refusal nor a successful local decode certifies 128 MB or
10 ms suitability. The 96 MiB value remains a research target, not a new
production limit.

Browser renderer `TaskDuration` is a main-thread task counter, not whole-browser
CPU; it excludes work in other processes/threads. JS heap snapshots exclude
backing/native allocations. Workerd phase clocks may have coarse/event-loop
resolution; host round-trip wall time is not its CPU. No controller-Node CPU,
Node RSS or browser heap snapshot is presented as provider CPU or peak RAM.

## What 10 minutes/day means for an invited pilot

The [planning models](../research/free-sharing/execution/budget.mjs) use the actual
cold local job observation, not decode-only time or warm-session latency. They
evaluate 3/5 publications/day, hypothetical 1/3/10× slowdown, one 30-second failed
attempt and one 60-second uncertain-close tail. A 300-second working allowance
leaves a planning reserve inside the published account-wide 600 seconds.

The slowest observed cold browser job was `8k-lossy.webp` at **4.172 seconds**. Five such successful local jobs plus one failed attempt and one uncertain-close tail model **110.9 seconds/day**, or **298.6 seconds/day** at hypothetical 10× slowdown. Both fit the 300-second research reserve in this model. A failure-heavy scenario with five successes at 10× slowdown, **five additional failed attempts and five uncertain-close tails**, models **658.6 seconds/day** and exceeds the entire 600-second allowance. These are sensitivity calculations, not measured service consumption.

These factors are sensitivity scenarios, not predictions or bounds for Browser
Run. Actual remaining account allowance is unknown. Concurrent/new-session rules,
startup, network transfer, SDK/controller costs, crashes and metering may change
the result. An uncertain close should stop/reconcile further publishing rather
than blindly retrying; that production behavior is not implemented here.

It would be incorrect to divide 600 seconds by a fast local decode and advertise
that many publications/day. A small 3–5/day cohort remains only a planning
assumption. No live quota, billing protection or daily capacity has been tested.

## Correctness, failure checks and existing safeguards

The research suite passes **103 tests**, comprising the existing 61 research
cases and 42 new execution/protocol/failure cases. The new runtime matrix retains
valid baseline/progressive/lossy/lossless behavior, rejects the six previously
accepted malformed-codec cases, and retains existing missing-EOI/container/EXIF
and PNG CRC rejection. Valid input after decoder rejection is tested.

Additional tests cover private source access, external fetch refusal, cancellation,
timeout after a first valid file, browser disappearance, uncertain cleanup,
spoofed hash/manifest/job/order receipts, size/count refusal and explicitly
injected attempt-quota behavior. None is a real provider quota-exhaustion test.
The `validated` state is a local research result; no real publication is activated.

The existing 84 image/upload/operations/configuration unit cases and formatting,
syntax, provenance, evidence and research type checks are recorded separately in
the final validation metadata. The unchanged production guard deliberately exits 1.
No production browser suite/build or hosted-CI success is inferred from these checks.

The [validation record](../research/free-sharing/execution-results/validation.json)
contains suite counts, commands, exact local tool versions, source/WASM hashes
and evidence hashes. It is a local provenance record, not provider certification.

This finite corpus does not prove universal codec conformance, metadata safety,
absence of vulnerabilities or complete production security. Existing checks are
preserved; full JPEG/WebP decoding is additive. The
[required validation profile](../research/free-sharing/VALIDATION_REQUIREMENTS.md),
decoder build/license/CVE review, broader malformed corpus and real resource
evidence remain necessary before accepting public originals.

## Comparison and remaining blockers

| Direction                                | New evidence                                                                                      | Verdict after A/B                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Current full-codec wrappers in Worker/DO | Same checks are portable; 8K two-copy lower bound exceeds the isolate envelope.                   | Reject this 8K execution design. Local PNG/limited 4K success is not Free CPU/RAM approval.            |
| Trusted browser execution                | Whole synthetic 4K/8K jobs preserve bytes and pass locally without a custom codec implementation. | Promising enough for provider clarification; actual Browser Run resources/path/budget remain unproven. |
| Custom resumable/validation-only codecs  | No new implementation or evidence in A/B.                                                         | Do not start this larger investment automatically.                                                     |
| Production storage migration             | No new storage or integration implementation in A/B.                                              | Keep current production architecture and deployment lock unchanged.                                    |

Before any later decision, resolve browser RAM/CPU and large-file path, controller
CPU, Free activation/billing conditions, actual session-time/failure accounting,
and privacy/retention coverage. The prior write-exhaustion/takedown and restore
problems remain; a browser executor does not solve them. Neither do invited users
remove the need for full validation, protected cleanup capacity or independent
emergency refusal.

If the provider cannot establish a sufficient Free execution envelope, record
this direction as unqualified. Do not infer entitlement from local success or
silently choose a paid plan. The owner can then reassess a narrower measured PNG
profile or the product constraints; neither choice is made by this PR.

**Authorized work ends here.** Questions are prepared, local artifacts and tests
are reviewable, and the PR does not merge, deploy, enable uploads, initiate a
remote measurement, migrate data or begin phases C–E/audit stage 8.
