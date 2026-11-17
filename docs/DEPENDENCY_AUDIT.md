# Dependency audit: temporary build-only risk acceptance

## Advisory and release check — 2026-11-17

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
(CVE-2026-112366, high, CVSS 7.5) affects picomatch `<=4.0.7`. The GitHub advisory
has no patched version and is not withdrawn. The npm registry's latest release is
still `4.0.7`. No published, compatible fix was available at review time. An open
upstream pull request is not evidence of a reviewed, released fix. We do not apply
unpublished code, a forced downgrade or a major transitive override.

The attack requires an attacker-controlled glob with repeated single-branch
extglobs, such as `+(*)` or `+(*a)`, and a crafted candidate string. These patterns
can bypass the repeated-extglob guard and cause exponential regular-expression
backtracking: a Node build/test denial of service, not image decoding or code
execution. A dependency being development-only does not by itself make this safe.

The unchanged lockfile installs one picomatch, `4.0.7`, marked `dev: true`.
Full npm audit reports **11 high rows from this one advisory**, including affected
parents, and **2 moderate rows** (`glob`, `minimatch`, separate advisories).
`npm audit --omit=dev` reports **zero vulnerabilities**. The moderate findings
remain visible under the existing high/critical blocking threshold; this exception
does not accept or suppress their separate advisories.

## Reachability in this repository

| Path in the pinned toolchain                                                                         | Pattern origin and candidate input                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite 7.3.7 → fdir / tinyglobby 0.2.17 → picomatch                                                    | Build discovery, configured include/exclude and development `fs.deny` patterns. Candidates are local project/dependency paths. Vite's `import.meta.glob` also compiles patterns from source; the app currently has no such calls. |
| Vitest 5.0.5 → picomatch / tinyglobby / Vite                                                         | Repository-controlled test discovery and tool defaults. `vitest.config.ts` supplies `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`.                                                                               |
| vite-plugin-pwa 2.0.0 / Workbox-build 7.4.1 → Rollup plugins → @rollup/pluginutils 5.5.1 → picomatch | Static-asset/plugin filtering. `scripts/pwa-build.ts` has fixed asset globs and disables manifest-icon discovery. Workbox also uses `glob`; that is a separate matcher/advisory path.                                             |
| @rollup/plugin-node-resolve → @rollup/pluginutils                                                    | Third-party `package.json` **sideEffects arrays can supply patterns**, so the trust boundary includes locked dependency metadata, not only our configuration.                                                                     |

Source inspection confirms that `createFilter` compiles a supplied pattern before
testing candidate paths. A strange filename alone is not an attacker-supplied glob.
The pinned dependencies' sideEffects arrays contain ordinary paths: zod's
`./compile.js`, `./compile.cjs`, `./src/compile.ts`, and the Cloudflare preset's
`./dist/runtime/polyfill/*.mjs`. None uses the vulnerable repeated-extglob form.

A temporary Node loader trace of a demo build observed Vite's fixed deny patterns
and zod's resolved compile paths. A traced Vitest discovery run observed the two
configured test globs, ordinary path segments and fixed secret/node_modules
exclusions. No observed pattern contained the vulnerable repeated extglobs. These
are observations of the reviewed build/discovery runs, not a proof about every
future input. The tracing hook was not added to application code or CI.

PNG/JPEG/WebP bytes, screenshot filenames, labels, metadata, URL parameters and
comparison gestures stay in browser/runtime handling. They do not feed this Node
toolchain's glob patterns. No app or API code imports picomatch. Artifact checks
inspect emitted web/service-worker source maps, and the audit policy test inspects
the Worker's esbuild input graph, to reject runtime inclusion. Android remains
separate from PWA integration; its existing native and browser tests are retained.

Existing workflows accept no external free-text glob: the build mode is a fixed
choice; base paths and plugin/test patterns come from reviewed source; Vite escapes
literal path syntax where applicable. Pull requests can change executable source,
configuration or dependency metadata and already have arbitrary build-code
execution. The validation workflow has read-only repository permissions and does
not publish. Publishing still requires reviewed `main`, a manual dispatch and the
exact `DEPLOY` confirmation. Production sharing's readiness lock remains intact.

**Residual risk:** a malicious or newly introduced build configuration/dependency
could cause CI or developer-machine CPU exhaustion. Lockfile integrity pins exact
packages; it does not establish that package authors are trustworthy. Do not treat
this acceptance as permission to process untrusted glob configuration, expose a
development server publicly or offer builds of arbitrary external projects. Any
such exposure invalidates this assessment. For the reviewed local screenshot PWA,
there is no identified public input route into the vulnerable matcher; a narrowly
bounded, temporary build-only acceptance is justified.

## Enforced exception

Both Validate and manual Pages publication run `npm run audit:dependencies`.
It first tests the policy, then runs **both complete npm audits** (`--include=dev`
and `--omit=dev`) as JSON. It does not filter the npm report or globally turn off
auditing. Raw `npm audit --audit-level=high` deliberately still exits nonzero.

`scripts/dependency-audit-policy.mjs` accepts a high row only when every high/critical
cause, recursively followed through npm's `via` graph, is precisely this advisory
URL with package/dependency `picomatch`, severity `high` and range `<=4.0.7`.
Affected parent names are not allowlisted. A parent with both this and another
high/critical cause is blocked. Further conditions are:

- The exact lockfile SHA-256, one installed `picomatch@4.0.7` node and development-only
  status for every affected dependency node match the reviewed state.
- The package scripts, Vite/Vitest/PWA configuration and both relevant workflow
  fingerprints match the reviewed input files. Changes require a fresh review.
- The current registry check still returns `4.0.7`; a new latest release stops the
  exception for review, even if it is a breaking release rather than a fix.
- The clock is within the review window: **2026-11-17 00:00 UTC through, but not
  including, 2026-12-01 00:00 UTC**. Expiry blocks CI and publishing.
- No production high/critical finding or any critical finding receives an exception.
  New/unexplained/mixed high causes, missing nodes, graph cycles, malformed reports,
  npm/registry/network errors and unsupported report formats fail closed.

The gate prints the advisory, expiry, accepted direct/derived rows, raw counts and
remaining moderate findings. `.wrangler/security-audit/` contains unmodified
`full.json`, `production.json` and an explicit `decision.json`. CI retains these
for seven days, including on failure; only this report directory is selected from
the ignored `.wrangler` tree. The sibling npm cache and local databases are not
uploaded. Reports are removed before each run so stale decisions cannot pass.

Policy tests use a recorded npm report and synthetic negative cases: unrelated and
mixed high/critical causes, identity drift, production scope, changed lock/config,
expiry, new upstream versions, malformed/network reports and missing/cyclic causes.
They also check that picomatch does not enter the API Worker bundle. The existing
PWA artifact matrix checks browser/service-worker source maps before publication.

## Removal and review conditions

1. When upstream publishes a fix, review its advisory/range and compatibility,
   update the smallest necessary dependency set and lockfile, and run the complete
   PWA/WWW/Android regression gates. Do not use `npm audit fix --force`.
2. Remove this exception and its recorded fixture/policy when the full audit no
   longer requires it. Restore a plain high/critical audit gate, retaining an
   explicit production audit if useful.
3. Reassess immediately on any runtime inclusion, new pattern/input source,
   dependency/configuration change, changed advisory or new exploitation evidence.
   The lock/config hashes and latest-version check intentionally require review;
   do not merely refresh fingerprints to make a failing gate green.
4. The exception expires automatically on **2026-12-01 00:00 UTC**. Do not extend it
   automatically. If no safe fix exists then, obtain a new explicit risk decision
   with fresh evidence or keep release blocked.

Local reproduction:

```bash
npm run audit:dependencies
npm audit --audit-level=high  # Expected nonzero while this advisory remains open
npm audit --omit=dev
npm run test:pwa:build
```

This decision changes neither the service-worker update lifecycle nor the public
sharing policy. It does not authorize a merge or deployment.
