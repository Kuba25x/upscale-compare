# Android Preview preparation validation

These are historical automated results from PR #26, not physical-device
qualification. The public [v0.1.0-android-preview.1](https://github.com/Kuba25x/upscale-compare/releases/tag/v0.1.0-android-preview.1)
is now available as a debug APK. Publication does not establish owner-key signing
or additional device-test results.

## Confirmed evidence

The preparation branch incorporates main 5dc582e8e6e219855904e5e3395cc761abd4ea9c,
including PR #25's isolated PWA build preparation. Its runtime registration,
offline/update flows remain disabled and Android omits the PWA integration.

| Run                                                                                                    | Source                                            | Confirmed result                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Web validation 43850299539](https://github.com/Kuba25x/upscale-compare/actions/runs/43850299539)      | PR merge 892fbaf9ec1933d32cfede5a38ce920265bc43bd | 312 unit/integration, 95 E2E, 139 demo, 37 local sharing, 7 diagnostics; production/subpath builds and TypeScript passed; PWA build/isolation job passed                               |
| [Release preparation 43851187349](https://github.com/Kuba25x/upscale-compare/actions/runs/43851187349) | PR merge b4be1cc7bc095c233fc84f5943bb603c854cbc31 | lintRelease/assembleRelease, 7 release-policy cases, 47 native source/license audits, 6 pinned upstream repositories, metadata/alignment/hash checks and disposable-key signing passed |
| Same release preparation run                                                                           | Same commit                                       | Extracted corresponding-source archive rebuilt successfully without .git; package/version and embedded commit matched                                                                  |
| [Android 43850299471](https://github.com/Kuba25x/upscale-compare/actions/runs/43850299471)             | PR merge 892fbaf9ec1933d32cfede5a38ce920265bc43bd | Android browser, adapter/config, lint, JVM, debug assembly/signature checks and one API 36 native scenario passed                                                                      |

The final [PR #26 checks](https://github.com/Kuba25x/upscale-compare/pull/26/checks)
are authoritative for the final head, including the lifecycle guard below.
These immutable snapshots do not claim that an older binary contains later fixes.
For future owner-signed candidates, run the manual workflow from main.

Signing tests reject a wrong certificate/commit, signed input, modified COMMIT or
checksum sidecars and damaged APK bytes. The signed APK's actual v2 signature,
certificate fingerprint and embedded license texts are checked. The disposable
key and test-signed APK are deleted; they are never uploaded as release assets.

All npm runtime entries, including transitive tslib (0BSD), have pinned preferred
source and retained notices. Native sources are exact Maven versions; their POM
licenses are audited and archive hashes recorded. npm audit --audit-level=high
passes. PR #25's build-tool dependencies currently produce **2 low and 4 moderate**
findings, documented in [PWA_BUILDS.md](PWA_BUILDS.md). These are not Android runtime
dependencies. No override/downgrade is introduced to hide the findings.

## Failures found and addressed

An intermediate demo-mobile test read the previous compact class before React's
scheduled rotation measurement. The test now waits for the expected layout.
Visibility, native-bridge isolation and retained-image assertions remain; web
application behavior is unchanged.

[Android run 43851187374](https://github.com/Kuba25x/upscale-compare/actions/runs/43851187374)
exposed a real Activity-destruction race: a delayed save called execute on the
stopped OriginalsPlugin executor, escaping as RejectedExecutionException and
crashing the process. The shared submission helper now rejects closed-executor
calls before any storage access, including a late picker callback. It does not
resubmit work, alter original bytes, change quotas or modify journal/cleanup policy.

Two deterministic native regressions destroy the plugin, then submit all four
storage methods and a successful picker result. They require an explicit closed
Activity rejection, zero provider opens and unchanged journal/original bytes.
The existing API 36 scenario still exercises Activity recreation with real
Capacitor/WebView dispatch. Final PR checks provide its post-fix result; the
failed run is retained as evidence rather than being described as a device pass.

## Physical device and owner gates

Browser tests mock the native bridge. API 36 instrumentation checks actual
window/inset policy, cutout/gesture regions, both landscape rotations, minimalist
transitions, Back, picker return, resume and recreation. Neither establishes
HyperOS behavior, OEM picker UX, sustained 4K/8K memory stability or HDR precision.

The signed release still requires Xiaomi 15T / Android 16 acceptance: memory traces,
repeated imports/replacements, pinch/pan and pixel presets, bars/cutout, cloud/Files
imports, cleanup failures and offline restoration. Record the signed APK hash,
source SHA, public certificate fingerprint and WebView/HyperOS version. Test an
update with a higher versionCode signed by the same owner key. Historical
mobile-web pinch reports do not qualify this native release.

Owner-only key generation, encrypted backup/recovery and offline signing are
documented in [ANDROID_RELEASE.md](ANDROID_RELEASE.md). No hardware or production-key
test is claimed. The provisional 256 MiB ceiling remains unqualified.

The PR does not change web application code, backend/deployment controls,
Share Comparison, file limits, storage quotas or the existing debug workflow.
The streaming importer is retained; its only behavior change is rejecting calls
submitted to a destroyed plugin instead of crashing. Corresponding source,
licenses and notices must accompany any future publicly distributed signed APK.

## Native Windows signing follow-up

The signing helper now uses native SDK executables and Java's apksigner.jar
without batch/shell interpolation. A bounded JDK ZipFile reader replaces unzip
without extracting untrusted APK paths. System32/tar.exe reads source provenance.
The production CLI requires an interactive terminal; no password flag, secret
environment variable or CI bypass flag is added.

The release workflow adds Windows Server 2025/PowerShell signing tests using the
same unsigned artifact and disposable keys. They cover spaces/Unicode/metacharacter
paths, input/output terminal requirements, metadata bounds/duplicates, successful
signature/certificate verification and wrong-key/commit/tampering failures.
Consult the final PR checks for results of this follow-up; no physical Windows 11
console or owner-key test is inferred from server automation. See
[the Windows runbook](ANDROID_WINDOWS_SIGNING.md).
