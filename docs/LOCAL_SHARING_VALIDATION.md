# Local production sharing validation

Share Comparison stage 5 validates the built production frontend with the actual
Worker in `ENVIRONMENT=production`, using only local D1/R2 and deterministic
verification doubles. It does not deploy, contact real Turnstile, select budgets,
enable a paid plan or change the production upload gates.

## Run the check

```bash
npm ci
npm run test:sharing:local
```

Use Node.js 22.12+ and the repository's Chromium setup (`CHROMIUM_PATH` can select
an installed browser). No Cloudflare account, real keys, `.dev.vars`, `.env` copy
or manually running API is needed. The test command:

1. Bundles the current Worker.
2. Builds two normal production frontends under the ignored
   `.wrangler/sharing-frontend/`: one with a dummy public site key, one without a
   key. Both use `/upscale-compare/`, with demo mode explicitly disabled.
3. Starts strict, loopback-only previews on ports 4176/4177. Each case gets a fresh
   Miniflare API on `127.0.0.1:8788`, all four migrations and explicit local test
   allowances. `ENVIRONMENT=production` retains server-side verification.
4. Runs Chromium desktop, selected mobile-emulation cases and the missing-key
   build. Stage 6 also runs the restoration/pixel matrix at DPR 1.25 and 2. The
   fixture disposes each API and Playwright stops its preview servers.

An occupied port fails startup; tests do not reuse an unrelated server. Output is
separate from normal builds: `dist/` and deployment configuration are not replaced.
Reports/traces are under `playwright-report/sharing` and `test-results/sharing`.
Fixtures contain generated screenshots and dummy credentials only. Never deploy
these test bundles or redirect this suite at a real upload service.

## What is real and what is replaced

| Layer                 | Local validation                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Frontend              | Real optimized production bundle, React lifecycle, API client, private journal and key storage |
| Browser networking    | Real cross-origin loopback requests, CORS, previews, hash redirects and refresh                |
| Worker                | Real workerd handler and production branch; no development verification bypass                 |
| Persistence           | Real local D1 SQL/triggers and private R2 emulator; fresh per-case state                       |
| Browser Turnstile SDK | Test router serves a deterministic stand-in for the one fixed SDK URL                          |
| Siteverify            | Miniflare outbound handler replaces the HTTPS request; no forwarding to Cloudflare             |

Browser HTTP routing allows the selected frontend and local API, fulfills the
fixed SDK URL locally, and refuses unexpected external requests. Service Workers
are blocked so they cannot evade that routing. The API's outbound handler rejects
any URL/method except the expected Siteverify POST. The fixture models single-use
tokens and records whether the dummy secret was supplied correctly.

The dummy site key/secret are **not Cloudflare test or live keys**. No test-token
recognition, alternate verifier URL or test-mode flag is added to application or
production Worker code. Verification replacements are confined to test fixtures;
the production application still loads the official SDK and calls the official
Siteverify endpoint. This separation avoids weakening production verification to
make local tests pass.

## Coverage

The browser cases exercise:

- Consent and verification as separate prerequisites, including action/site-key
  parameters sent to the widget; no image upload on selection or token expiry.
- Publication, private key backup, canonical Worker link, repository-subpath
  redirect, public refresh and owner deletion, including mobile emulation.
- Expiry, rejected tokens, fresh-token retry with the same publication identifier,
  and no automatic repeat upload.
- Lost publication responses, single-use verification and result recovery after
  refresh while uploads/verification are disabled.
- Script error/retry, close/reopen after a failed load, delayed load across dialog
  lifetimes, a bounded script timeout, widget error callbacks and render/reset
  exceptions, with publication remaining controlled and local comparison intact.
- Missing frontend key, missing backend secret, disabled uploads, an emergency
  stop after a healthy readiness response, and a disallowed frontend CORS origin.
- Stage-6 [original-file and restoration coverage](ORIGINAL_FIDELITY.md): mixed
  PNG/JPEG/WebP, byte/decoded-pixel hashes, metadata, full view settings,
  immutable visitor changes, public 100% pixels and missing-source errors.

The production Worker integration suite additionally rejects wrong hostname or
action, non-boolean success, HTTP failure carrying a success-shaped body, malformed
JSON, failed transport, timeout, empty tokens, consumed tokens and disallowed
origins. Failure assertions inspect actual local rows, quota, markers and objects
so a response-code assertion alone cannot hide a partial publication.

## Fixes established by this stage

Two browser regressions reproduced the old dead-script behavior: after the first
load error, reopening waited on an event that had already fired, and no explicit
same-dialog retry was available. Three API/readiness regressions also failed on
the stage-4 baseline: a truthy string success and an HTTP 503 success-shaped body
were accepted, and health advertised uploads without a production secret.

The client now shares a bounded script-load attempt, cleans its listeners/timer,
removes failed/stalled scripts and offers **Retry verification**. Async callbacks
respect dialog disposal; SDK render/reset failures become recoverable UI errors.
Unsuccessful publication attempts clear/reset verification, while success removes
the widget without requesting an unused challenge. Disabled/unconfigured flows
do not load it. The existing demo still never contacts verification.

Siteverify must now return an OK HTTP response and literal boolean `success: true`
with the existing allowed hostname and exact `publish` action. Production health
requires a nonempty secret as well as the existing flag/policy/day capacity; it
does not prove that the supplied secret/key/account configuration is valid.

Official contract references: [explicit widget rendering and API](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
and [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
The provider documents five-minute, single-use tokens. These tests drive the
callback/response contract locally, rather than waiting for a real challenge.

## Executed results

At the stage-5 checkpoint on 2026-10-28, the final production build/typechecks and all four local suites
passed: **245 unit/API + 45 regular browser + 20 production-sharing browser +
31 production-demo = 341 cases**. This stage adds 10 API and 20 browser cases.
The five baseline regressions above were executed red before the production
fixes. Formatting and `git diff --check` passed. The complete existing 40 MiB
original-byte round trip remains part of the passing API suite. Hosted CI
results are reported separately on the PR.

## Boundaries and remaining verification

This proves local production-code behavior, not a real provider integration. The
SDK iframe, bot detection, real challenge issuance, key/secret pairing, hostname
registration and provider policies still need an approved real-environment smoke
test before opening uploads. HTTP loopback does not validate production HTTPS,
DNS, custom-domain/edge rules, provider permissions, quotas, replication, latency,
billing or physical-device/Safari behavior. No new CPU/memory benchmark is made.

Stage-1 resource ceilings, stage-2 cleanup, stage-3 recovery and stage-4 budgets/
stop controls stay in force. Production remains paused/zero-budget with uploads
disabled until separate approval. Stage 6's broader matrix is recorded separately
in [original fidelity](ORIGINAL_FIDELITY.md); later deployment/operations stages
are not started by this work.
