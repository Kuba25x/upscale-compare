# Phase A/B validation execution laboratory

This is **local-only research**, not Cloudflare Browser Run, a new production
validator, a storage migration, a deployment harness or audit stage 8. See the
[comparative report](../../../docs/FREE_VALIDATION_EXECUTION_RESEARCH.md) and
[unsent provider questions](CLOUDFLARE_QUESTIONS.md).

## Reproduce

From the repository root, with the existing root dependencies, a local Chromium
and the separately locked research dependencies installed:

```bash
npm ci --ignore-scripts --prefix research/free-sharing
# Optional host prerequisite for fixture generation: Python + Pillow (12.3.0 used).
python research/free-sharing/generate-fixtures.py
python research/free-sharing/execution/generate-png.py
npm --prefix research/free-sharing test
npm --prefix research/free-sharing run probe:execution
npm --prefix research/free-sharing run summarize:execution
```

The probe uses a bundled Playwright Chromium if present, otherwise
`/usr/bin/chromium`. It launches no remote browser and accepts no URL/account/API
target. Local sockets/processes must be permitted. It uses a non-listening
loopback proxy as an external-network sink, page-route restrictions and a local
HTTP source with a strict CSP. The managed test environment requires
`--no-sandbox`; **no browser-sandbox equivalence to Cloudflare is claimed**.
No Playwright trace, video, HAR, screenshot or provider recording is enabled.

`--png-noise-only` and `--workerd-only` are optional local subset flags. No remote
flag exists. These subset files allow a revised case/runtime group to be collected
without rerunning unrelated samples. The summarizer chooses the newest complete
six-sample group per case/runtime from known scratch batches. A subsequent full
run supersedes old subset results. Inspect the selected batch metadata.

Generated originals, compiled bundles, ephemeral state and current JSON go to
ignored `.wrangler/free-validation-execution/` (large codec fixtures reuse the
earlier research scratch directory). Summarization explicitly archives results
under `execution-results/`; raw measurements are JSON Lines, one job per line.
Never describe reproductions as newly measured Cloudflare behavior.

## Protocol and scope

- The Node fixture controller stores synthetic originals before the timed job.
  A capability protects each pending job; only exact local fixture URLs exist.
  Uploading from a user, D1/DO persistence, Turnstile, production invitation,
  public views and maintenance are **not in this path**.
- The page fetches original binary bytes directly. No original or decoded raster
  is marshaled through a huge JSON/CDP argument. Only small descriptors and
  receipts cross the automation boundary; image bytes are never HTML.
- Both runtimes execute the unchanged production validator plus the existing
  strict full JPEG/WebP decode candidate. Hashes before/after and manifest/job,
  index, length, MIME and dimensions must agree before a local completion result.
  A receipt from an arbitrary client would not be trusted by a real service.
- Files run sequentially. The browser uses one isolated context/job and a fresh
  page/file, closing pages/contexts and owned browsers after work. Uncertain close
  acknowledgment rejects completion; timeout/cancel/crash do not accept a partial
  job. There is no real public activation endpoint.
- Workerd is a local Worker handler, not a newly integrated DO/production broker.
  Its theoretical two-RGBA-copy check avoids known 8K allocation failures. An
  additional observed 96 MiB lower-bound rejection is a research classification,
  not safe pre-allocation proof. Neither acceptance nor rejection certifies Free.
- One isolated cold job and five measured warm jobs follow an omitted warm-up.
  Browser cold includes launch/close; warm reuses a browser and excludes those
  costs. Packaging is outside execution timers. Local workerd cold includes its
  emulator/runtime startup. Different transports/lifecycle make these diagnostic
  observations, not provider-speed comparisons.
- Phase timers, renderer main-thread TaskDuration, JS heap snapshots and retained
  buffer lower bounds have different scopes. TaskDuration is not whole-browser
  CPU; JS heap excludes backing/native allocations; PNG stream peak is unknown.
  The host controller's CPU is not reported as browser or workerd CPU.

Fixtures cover 4K/8K PNG 8/16-bit, real high-entropy IDATs, valid ancillary padding
to exactly 20 MiB, baseline/progressive JPEG, lossy/lossless-alpha WebP, two-image
jobs, and four-image mixed/exact-40-MiB controls. They are deterministic noise,
grids or constant rasters, not representative user screenshots. Generating lossy
test fixtures is not a proposal to convert application originals.

## Budget interpretation

`budget.mjs` models 3/5 daily publications, hypothetical 1/3/10× slowdown,
30-second failed-work allowance and 60-second uncertain-close idle tails. Its
300-second working budget is a planning reserve inside the documented 600-second
account allowance, **not a configured quota or measured bill**. Active-task
timeouts are distinct from Browser Run's default idle timeout.

The browser time allowance is shared account-wide. Cold local time cannot predict
remote session time, rate-limit waiting, existing sessions or startup/network
behavior. Warm decode time cannot be used to claim daily capacity. The local
protocol deliberately does not emulate the real one-launch-per-20-seconds rule.
No actual provider quota was consumed, enforced or exhausted.
