# Android Preview preparation validation

These are automated results, not Xiaomi 15T qualification. No production key,
public tag or GitHub Release has been created.

## Confirmed runs before the final documentation/source-pin cleanup

Preparation head: 69d99473ee21a1e3d6a3c1b1eba85a2efdb8339c.
The workflows build PR merge commit 035cc751858e509400cfe56658e8131bc675a6ed.

- [Release preparation 43847091584](https://github.com/Kuba25x/upscale-compare/actions/runs/43847091584):
  lintRelease/assembleRelease, 7 release-policy tests, collection and license audit
  of 47 native runtime artifacts and 5 upstream source repositories, unsigned
  APK/alignment/provenance checks and real-APK disposable-key signing all passed.
  Wrong certificate/commit, already signed input, changed COMMIT/checksum sidecars
  and damaged APK are rejected. The disposable key and test-signed APK are removed.
- [Android debug 43847091685](https://github.com/Kuba25x/upscale-compare/actions/runs/43847091685):
  Android browser tests (15), adapter/config subset (13), Android lint, JVM tests,
  debug assembly/signature checks and one API 36 native instrumentation scenario
  all passed. Native reports and captured frames are attached to that run.
- [Earlier complete web regression 43845112126](https://github.com/Kuba25x/upscale-compare/actions/runs/43845112126)
  passed: 312 unit/integration, 95 E2E, 135 demo, 37 local-sharing and 7 diagnostics
  cases, production/subpath builds, TypeScript checks and npm audit (zero findings).
  These web source files remain unchanged by this PR.

The final PR checks are authoritative for the final head. The run links above
are immutable evidence for the stated commits, not a claim that an older binary
contains subsequent documentation or source-pin changes. After merge, use the
manual main workflow for the actual candidate.

## Evidence boundaries and remaining owner work

The Android browser bridge is mocked. The API 36 emulator tests actual native
window/inset policy, cutout/gesture safe regions, both landscape rotations,
minimalist transitions, Back, picker return, resume and Activity recreation.
Neither layer proves HyperOS behavior, OEM picker UX or sustained 4K/8K memory use.

The signed release still requires Xiaomi 15T / Android 16 acceptance, including
memory traces, repeated import/replace cycles, pinch/pan, Fit and physical-pixel
presets, system bars/cutout, cloud/Files imports, failure cleanup and offline
restoration. Record the signed APK hash, source commit, public certificate
fingerprint, WebView/HyperOS version and results. Test a higher-versionCode update
with the same owner key. Existing historical web-pinch device reports do not
qualify this native release.

Production key generation, encrypted backup/recovery and offline signing are
owner-only steps in [ANDROID_RELEASE.md](ANDROID_RELEASE.md). CI uses a throwaway
test key solely to validate the process. No hardware or production-key test is
claimed.

The PR does not change src/, shared/, worker/, web limits, import/storage policies,
Share Comparison, the existing Android debug workflow or production deployment
controls. AGPL source/notices are included in the preparation bundle. The owner
must review and retain them alongside any future public signed APK.

## Intermediate browser-test race

[Run 43847091692](https://github.com/Kuba25x/upscale-compare/actions/runs/43847091692)
reported one demo-mobile failure after rotation: the test read the old compact
class before the scheduled React viewport update, then asserted the wrong set of
controls. The regression now waits for the expected portrait/landscape class.
Visibility, native-bridge isolation and retained-image assertions are preserved;
no web application code is changed. Final PR checks include the corrected test.

The final license review also identified transitive tslib (0BSD). Its copyright,
license and pinned source are now included, bringing upstream source repositories
to six. The collector checks every non-development npm lockfile entry so an
unlisted transitive runtime dependency fails preparation.
