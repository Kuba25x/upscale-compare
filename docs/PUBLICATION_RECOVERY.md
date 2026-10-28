# Publication and cleanup recovery

This is the Share Comparison stage-2 cleanup foundation. It requires migration
0002_publication_recovery.sql and does not enable public uploads. Stage 3 adds
[recoverable publication retries](PUBLICATION_RETRIES.md) and migration 0003.

## Invariants

- New publications insert a pending row and reserve quota in one SQLite statement:
  INSERT ... SELECT checks byte/count limits and an AFTER INSERT trigger charges
  the ledger. Failure rolls back both. There is no new-code crash gap between a
  separate reservation and its record.
- Pending/deleting records are never publicly readable. Every original write
  checks the pending state and one-hour publication deadline; activation is a
  conditional update of that same pending record.
- Cleanup makes the record inaccessible before deleting R2 objects. It targets
  all four possible generated keys, including writes which committed without an
  acknowledged response. It does not parse potentially damaged manifest JSON.
- Quota release and deletion of the persisted marker share one D1 batch. Release
  uses the current row and its deletion digest, so concurrent/repeated cleanup
  cannot charge another generation or release capacity twice. Missing or
  inconsistent quota prevents successful finalization rather than clamping a
  negative ledger and discarding the marker.
- Failure before a confirmed pending INSERT does not invoke destructive
  compensation: an ID collision belongs to another publisher, and an ambiguous
  commit may have left an accessible-to-maintenance pending record.
- An activation whose response was lost is not compensated if D1 reports the row
  as active. The response can still be 503; stage 3 recovers its result using the
  private key already saved by the client, without another image writer.

D1 documents transactional rollback for a failed batch:
[D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
The D1 transaction does not encompass R2.

## Cleanup queue

The three new fields are internal and never added to public manifests:

| Field             | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| cleanup_after     | Next eligible attempt/deadline, in epoch milliseconds           |
| cleanup_attempts  | Number of claimed cleanup attempts                              |
| delete_not_before | Earliest time an abandoned upload's reservation may be released |

The hourly handler selects at most 10 due records, ordered by attempt count, due
time and ID. Less-attempted records take priority so a failed batch cannot
continually block later work at subsequent hourly runs. A conditional update
rechecks the current state and acquires a five-minute lease. A record activated
after candidate selection is skipped.

Failures defer that record with exponential backoff from one minute to one hour.
If the retry update also fails, the persisted lease is the fallback. Independent
records are processed before an aggregate error marks the run failed; raw storage
errors, manifests and private capabilities are not logged. Failure of expired
rate-counter or stage-3 retry-marker cleanup also does not prevent comparison cleanup. A D1 outage during
candidate selection can still prevent that run.

The batch size keeps comparison work bounded. The worst normal failure path is
three D1 calls and one R2 call per row, plus four initial D1 calls including
stage-3 marker expiry and stage-4 daily-counter retention (at most 44 calls for a full failure batch). Backoff and
bounded batches are recovery controls, not spending limits.

## Interrupted writes and retention

An upload gets a one-hour pending deadline after validation. A publisher that
observes a reclaimed record cannot activate it or start another image write.
When maintenance reclaims an expired pending row, it keeps a deleting marker and
the full reservation for an additional hour. It deletes all possible keys on
that pass and again before final quota release.

If an operator deletes a still-pending upload, the grace starts after the later
of its pending deadline and the deletion request. Known failed publications whose
R2 operations have already returned can be compensated immediately. Normal
active-comparison deletion also finalizes immediately when storage succeeds.

Public access is blocked as soon as the deleting transition commits. Physical
cleanup and release may take longer due to grace, hourly scheduling, the batch
cap, backoff or provider outages. There is no fixed removal-time guarantee.
Already-open downloads and external copies cannot be recalled.

The grace is a conservative safeguard for late writes, not a proof about
arbitrarily delayed R2 commits. Cross-service atomicity is unavailable here.
Real-cloud interruption/latency behavior, backlog monitoring and orphan-object
reconciliation still require approved operational verification. Do not reduce
reservations while any in-flight writer or retained object is unaccounted for.

## Migration and rollback

The migration preserves existing manifests, deletion hashes, states and quota.
It backfills deadlines for pending rows and adds an index over the non-active
cleanup queue. It never silently reduces old conservative over-accounting.

The trigger charges new rows with an explicit positive cleanup_after. A legacy
Worker INSERT omits that field and already reserves separately; its default zero
therefore avoids double charging during transition. Recent legacy pending rows
with zero cleanup_after still receive their original one-hour grace.

For a future approved deployment:

1. Keep publishing disabled. Put deletion and scheduled maintenance into an
   operator-controlled maintenance window and drain in-flight writers/jobs.
   UPLOADS_ENABLED alone does not pause deletion or cron.
2. Back up D1 and inspect its ledger and private R2 inventory. Use the documented
   reconciliation procedure for legacy drift only after identifying all retained
   objects and reservations.
3. Apply the additive migration before the new Worker, then verify bindings and
   local-equivalent failure cases in the approved environment.
4. Inspect the backlog and failed cron runs before restoring maintenance.
   Monitor due records, attempt counts, grace markers and quota differences.
5. Do not roll back to the old janitor while new recovery records exist: it
   ignores leases, fair ordering and grace. Keep writes/jobs paused and use a
   reviewed roll-forward or database recovery procedure.

No migration or resource operation against production is part of this stage.

## Verification

Fault injection wraps real local D1/R2 operations before or after execution. It
does not replace SQLite with a mock engine or add public test endpoints.
Coverage includes reservation/trigger failures, ambiguous acknowledgments,
every original write position, failed compensation, atomic release rollback,
missing quota, migration compatibility, stale janitor candidates, sustained
failure fairness, concurrent cleanup and late objects during grace.

Original-byte, manifest-restoration, upload-resource and browser regressions
remain in the existing suites. Local tests do not establish production provider
failure semantics or billing/CPU suitability. Publication idempotency and key
recovery are documented in stage 3, and [daily budgets/emergency stop](COST_CONTROLS.md)
in stage 4. Production rollout still needs separate authorization.
