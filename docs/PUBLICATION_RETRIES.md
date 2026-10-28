# Recoverable publication retries

Share Comparison stage 3 requires migration `0003_publication_retries.sql` after
0001/0002. It does not enable uploads, deploy resources, or change image limits.

## Protocol and guarantees

Before any publication request, the frontend generates two independent 256-bit
random values: a publication identifier suffix and a private deletion key. It
persists and reads back an API-scoped recovery record before contacting the API.
If storage is unavailable or the 20-record pending journal is full, publication
stops before upload. The record contains credentials, creation time and a request
fingerprint, not images, filenames, labels or other plaintext comparison data.

Requests send `Idempotency-Key: <13-digit-epoch-ms>.<64-lowercase-hex>` and
`Authorization: Bearer <64-lowercase-hex-deletion-key>`. Neither value belongs in
a URL, public manifest, analytics, logs or support report. Use HTTPS outside
local development. The API stores only hashes of credentials.

1. The frontend checks `POST /api/publications/result` with both headers. A new
   identifier returns 404 and can be used for the initial upload.
2. A new `POST /api/comparisons` still requires enabled uploads, the existing
   resource/rate/quota controls, valid originals and production Turnstile.
3. Pending insertion, quota reservation and a unique private retry marker are
   one D1 transaction through INSERT triggers. A duplicate identifier cannot
   start another R2 writer, even across isolates or when capacity is now full.
4. The marker binds the identifier to the deletion digest and a SHA-256 request
   fingerprint. The fingerprint includes normalized manifest fields plus each
   original's media type, size and SHA-256 digest in upload order. Filenames,
   multipart boundaries and challenge tokens are excluded. Changed content or
   settings with the same credentials returns 409. A wrong capability returns
   the same 404 as an unknown identifier.
5. Matching retries return the existing active result or 202 pending. They do not
   write images, reserve quota again or consume another challenge. The separate
   result endpoint needs neither image bytes nor Turnstile and remains available
   with uploads disabled or a missing production verification secret.
6. The frontend makes at most one result check after a failed upload response;
   it never automatically resends images or polls. Further checks/retries need a
   user action. Each finished upload attempt clears/resets its challenge. If no
   marker exists, a retry needs a fresh production challenge because the prior
   token may already have been consumed.

The unit of idempotency is one identifier. Independently initiated operations,
including simultaneous new actions in different browser tabs, can have different
identifiers and can create separate comparisons. This is not global image deduplication.

## Recovery and terminal states

The recovery window is 24 hours from the client identifier timestamp. The server
allows at most five minutes of future clock skew; an expired identifier cannot
start a new reservation, including after its marker has been purged. Client clock
errors can shorten/refuse recovery. Active comparisons themselves do not expire.

| Stored state                                                        | Result and permitted action                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| No marker                                                           | 404; retry the original upload with the same credentials and a fresh challenge |
| Live pending row                                                    | 202; check again later, without resending images                               |
| Active row                                                          | Existing ID and share URL; use the already-saved private deletion key          |
| Expired pending, deleting, failed/removed row or expired identifier | 410; never recreate that operation                                             |

A pending writer is not taken over or resumed. An interrupted writer without a
completion must pass through stage-2 cleanup. New publication after a terminal
result is a separate explicit action requiring renewed consent; an expired
operation may still have an active public link. Its saved recovery key is retained.

Closing the dialog or refreshing retains the recovery journal. **Recover
publication** is available even on the empty landing page. It checks the result
and restores the normal share/deletion UI without original local files. Once the
ID is known, the frontend saves and verifies the normal API/ID-scoped deletion
key before removing the journal entry. A failed final save retains that entry and
offers the key in the share UI for backup. Recovery key files can also be
downloaded; importing these files into the UI is not implemented (manual API
recovery with their credentials is possible within the window).

Unresolved entries are never automatically discarded locally, including after
expiry. Removal requires an acknowledgment about the private key. Clearing browser
data, browser eviction, losing a backup or an origin change can still lose control.
The server cannot reconstruct plaintext keys. Local files/settings still disappear
on refresh; retrying an unreceived upload requires reselecting the same originals
and settings. A matching fingerprint reuses its saved operation.

## Retention, maintenance and costs

Retry markers survive comparison deletion/compensation to prevent resurrection.
They contain the comparison ID, hashed credentials, fingerprint and expiry, with
no image/manifest copy. Temporary INSERT columns on comparisons are cleared by
the same trigger; expired markers are deleted in batches of at most 100 per hourly
run. Backlog/outages can extend metadata retention beyond 24 hours. Expiry failures
are aggregated without blocking independent comparison cleanup.

Creation adds indexed D1 writes and sequential SHA-256 work over originals; a
normal frontend publication also adds a result lookup. Recovery has its own
20-per-minute fixed-window per-IP limit and does not consume the upload allowance.
It still consumes Worker/D1 operations. Bounded cleanup/journals and existing
storage quotas are not global spending caps. Distributed creation/deletion can
grow the marker backlog; global cost controls/monitoring remain a later stage.
There is no new CPU/memory benchmark or claim of Workers Free suitability.

## Migration and verification boundary

For a separately approved deployment, follow the stage-2 maintenance/drain/backup
procedure and apply 0003 before the new Worker, then update the production frontend.
Existing comparisons, deletion hashes, quota, pending deadlines and cleanup leases
are preserved; old rows get no synthetic recoverable operation. Legacy publish
clients without the two new headers now receive 400 and must reload/update.
Older Workers do not provide recovery guarantees; avoid a blind rollback or
removing live markers while writes can still arrive.

Tests use real local workerd/D1/R2 with fault injection around committed operations,
plus browser-intercepted lost responses/storage failures. Production-style
single-use verification tests use a local transport fake; they never call the
Turnstile service. These checks do not establish real-cloud latency/failure
semantics, device storage durability, production CPU/billing margins, edge
configuration or actual Turnstile account behavior. See [testing](TESTING.md).
