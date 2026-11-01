# Isolated Free-sharing research

The separately authorized [phase A/B execution laboratory](execution/README.md)
adds local workerd/Chromium comparison, failure tests and daily-budget scenarios.
Its [report](../../docs/FREE_VALIDATION_EXECUTION_RESEARCH.md) and
[archived execution evidence](execution-results/summary.json) supplement the
historical storage/codec results below. Neither local runtime certifies Cloudflare
Free, and no production architecture or deployment control changes.

Local experiments authorized separately from audit stage 8, based on `main`
`ec6ff358dc795eee960ae6c88661ff4832eb0c6d`. See the
[technical report](../../docs/FREE_STORAGE_RESEARCH.md) and
[validation requirements](VALIDATION_REQUIREMENTS.md).

**Do not deploy this prototype.** It intentionally has local fault/quota controls,
no Turnstile, no account-wide admission/maintenance service and only the existing
production image checks in its storage finalizer. Complete JPEG/WebP decoding is
a separate experiment, not integrated into storage activation. No Wrangler file
or deployment command is provided. This is not a replacement for production R2,
a production API, a release approval or Free resource certification.

## Run locally

Use Node 24 and the repository's locked root npm dependencies. Install research
dependencies independently; root `package.json`/lockfile are unchanged:

```bash
# From the repository root; package installation contacts only npm.
npm ci
npm ci --ignore-scripts --prefix research/free-sharing
npm --prefix research/free-sharing test
npx tsc -p research/free-sharing/tsconfig.json

# Optional synthetic large-codec resource experiments (Pillow 12.3.0 used).
python research/free-sharing/generate-fixtures.py
node --expose-gc research/free-sharing/codec-probe.mjs
node --expose-gc research/free-sharing/png-probe.mjs
```

Tests require local loopback sockets for Miniflare/workerd. Harnesses set
`cf: false`, reject external Worker fetches and configure local SQLite/KV bindings
only. No Cloudflare credentials, account, remote proxy, R2 or paid service is
used. Scratch databases, generated images and current output are written under
ignored `.wrangler/free-storage-research/`. A temporary database used for restart
checks is removed after the test. Archived evidence in `results/` is not
overwritten by reproduction. Python/Pillow is an optional host-only fixture
generator, not a Worker dependency or a proposed validation service.

`npm test` at the repository root retains its existing test selection; it does
not include this independent research suite. The repository's existing CI checks
production behavior; research evidence reported here was executed locally.

## What is being tested

- `prototype.ts`: one SQLite-backed DO per comparison; either SQLite BLOB segments
  or KV segments as the original-byte store, with SQLite control/journal state.
  Parts are at most 1 MiB, originals at most 20 MiB and comparison totals at most
  40 MiB. Stored parts are reassembled for whole-file validation and hashing;
  public output streams the original ordered segments. This finalizer is **not**
  a strict-10-ms staged validator and cannot be used as one.
- Private capability, pinned manifest/file identity, pending/active/deleting/deleted
  states, ambiguous-write recovery, generation stop fences, logical-first bounded
  deletion, raw-byte reads and emulator persistence across restarts.
- Fault injection models lost acknowledgments before/after durable writes and
  activation/deletion. Restarts are orderly emulator shutdown/reopen, not actual
  power loss. Missing KV reads, stale values and resource exhaustion are explicitly
  **models**, not real Cloudflare quota/propagation measurements.
- `codecs.mjs`: additional full JPEG/WebP WASM decoding after the unchanged
  production validator. Recoverable decoder warnings cause rejection. Finite
  malformed/valid inputs do not prove complete codec conformance or security.
- A compiled-WASM-module workerd test verifies local runtime compatibility on
  small inputs, without dynamic code generation or external codec fetches.
- Resource probes report Node component CPU or retained allocation lower bounds,
  never Cloudflare CPU, statistical tails or peak isolate memory.

An intentionally passing limitation test records that an already-active object
can remain readable when injected SQL write exhaustion prevents a durable
deletion marker. This is **not an accepted production behavior**. It motivates
the report's independent visibility/edge-stop and deletion-reserve requirements.
The public gateway also permits arbitrary research IDs; a real implementation
must check an authoritative directory before allocating a DO for an unknown ID.

The prototypes cannot settle service-plan limits, provider billing, global KV
consistency, distributed failover or physical data/backups erasure. No readiness
flag or production lock is changed by their results.

## Research dependencies

`@jsquash/jpeg@1.6.0`, `@jsquash/webp@1.5.0` and the locked transitive
`wasm-feature-detect@1.9.0` are Apache-2.0 packages from
[jSquash](https://github.com/jamsinclair/jSquash) and
[wasm-feature-detect](https://github.com/GoogleChromeLabs/wasm-feature-detect).
Their files and license notices stay in installed `node_modules/`; no third-party
codec binary/source is vendored or shipped with the application. The research
lockfile pins npm integrity. Zero npm advisories in the recorded audit are not
a native-codec CVE review or proof of embedded upstream versions. Any future
production decoder needs a reproducible build, license/SBOM/CVE review and
malformed-input/resource testing. Existing project licensing remains unchanged.
