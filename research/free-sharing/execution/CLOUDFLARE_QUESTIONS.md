# Questions for Cloudflare — not submitted

These questions were prepared from public documentation in phase A. No account
was inspected and nobody contacted Cloudflare on the owner's behalf. A reply
must identify the applicable Workers **Free** plan rule; a local runtime default,
Paid-plan answer or successful isolated sample does not settle an entitlement.

Context: a small invited screenshot-sharing pilot preserving original files,
up to 20 MiB/file and 40 MiB/comparison, no R2 or paid fallback. Validation would
process untrusted image bytes using pinned server-owned JavaScript/WASM and
return only bounded hashes/metadata. It would not execute uploaded HTML/scripts.

## 1. Durable Object CPU

For a SQLite-backed DO on Workers Free, with no custom `cpu_ms` setting:

- What is the maximum active CPU budget for DO `fetch`, RPC and alarm handlers?
  The DO table/FAQ says 30 seconds, but also refers to Workers' plan-dependent
  limits; the Workers Free HTTP table says 10 ms. Which explicit rule applies?
- Is the caller Worker's budget distinct from the DO's budget, including returned
  streams? How do overlapping calls and request-reset semantics interact?
- Which costs of hashing, native decompression, WebAssembly and stream callbacks
  enter each CPU meter, and which free aggregate metrics expose them?

Sources: [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[DO FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## 2. Browser Run memory, execution and supported workload

For Browser Sessions on Workers Free, using Playwright/Puppeteer/CDP:

- What are the enforced numeric RAM/CPU limits per browser process, context and
  account? Do Free and Paid browser instances have different allocations?
- Is the browser's memory/CPU separate from the 128 MB/10 ms controller Worker
  envelope? Which CDP/SDK serialization and binding operations use Worker CPU?
- Is complete validation of binary images with server-owned WASM a supported
  workload? Our tested wrapper's lower bound reaches about 392 MiB per 8K image,
  excluding browser/runtime/native/transient allocations. No adequate browser
  allocation is assumed merely because local Chromium succeeds.
- Can one session safely process sequential images with separate pages/contexts,
  and what memory survives closing each context? Which memory/resource failures
  and free metrics can the controller observe?

Sources: [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/),
[FAQ](https://developers.cloudflare.com/browser-run/faq/).

## 3. Large-file path and local parity

- Does the FAQ's 1 MB local-development request limitation apply to binding/CDP
  command payloads, page-origin fetches, or both?
- In the actual service, may a page fetch a 20 MiB original directly from a
  private authenticated Worker route, avoiding serialization of the original
  through a CDP command? What request/response/body limits apply along that path?
- Which private-origin authentication, outbound restriction and streaming
  mechanisms are supported? Are redirects/subrequests separately limited?

The local experiment uses ordinary localhost Chromium, not a Browser Run local
binding. Its successful 20 MiB fetch is not evidence about the actual service.

## 4. Exact Free budget and shutdown

- Confirm that the Free 600 browser seconds/day and three-browser concurrency
  rules refuse excess usage without billable overages or an automatic upgrade.
  Does enabling a Free binding require any separately billable subscription?
- When does session time begin/end: queued launch, browser startup, network wait,
  active validation, context close and browser close? Is usage rounded per task?
- When a deadline expires, controller disconnects, browser crashes or a close
  acknowledgment is lost, how long may the session continue consuming time?
  Does the 60-second default idle timeout reliably bound each of those cases?
- At daily exhaustion, are existing sessions terminated, only new launches
  refused, or are some operations still admitted? When does the allowance reset?
- How can exact Browser Sessions time and closure reason be observed without
  paid logs/recording? The documented `X-Browser-Ms-Used` example concerns Quick
  Actions; its availability is not assumed for this session protocol.
- Are failed Browser Sessions metered differently from failed Quick Actions?
  The latter's documented timeout exception is not assumed to cover Sessions.

Sources: [pricing](https://developers.cloudflare.com/browser-run/pricing/),
[limits](https://developers.cloudflare.com/browser-run/limits/).

## 5. Privacy and recovery

- Does the FAQ's ephemeral-content policy explicitly cover binary image bytes
  fetched inside a custom WASM validation page, including failures and crashes?
- Are original bytes, authorization headers or validation results retained in
  provider logs, dumps, caches or support diagnostics? What are their retention
  and location policies when session recording and crawl are not enabled?
- For future SQLite storage, clarify Free per-object size (general table versus
  FAQ), PITR/backup retention and deletion/restore behavior. A durable takedown
  must not be undone by restoring an older object/database snapshot.

Sources: [Browser FAQ](https://developers.cloudflare.com/browser-run/faq/),
[SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## Required evidence before any later account operation

Public availability is not verification of the owner's actual plan, other account
usage or settings. Any future resource creation, private edge measurement, account
inspection or contact with Cloudflare requires the owner's separate authorization.
Phases C–E and audit stage 8 remain out of scope. No Paid upgrade, R2 activation,
public upload or production deployment is an acceptable fallback.
