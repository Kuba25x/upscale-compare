# Android release preparation

For v1.0.0 follow the complete [Windows owner guide](RELEASE_1_0_GUIDE.md).
The debug [Preview workflow](ANDROID_PREVIEW.md) is for historical pre-releases.

## Trust and signing model

The existing **Android debug APK** workflow is retained for testing. A separate
**Android release preparation** workflow builds an **unsigned**, non-debuggable
release APK and source bundle with read-only repository permission. It cannot
publish, create tags or access a production signing key. Its unsigned APK is
not installable until the owner signs it.

Production signing happens on a trusted owner-controlled computer, outside
Gradle, npm and GitHub Actions. No production signing secrets are needed in
GitHub. Never upload the keystore, its private key, passwords or recovery copies
to a PR, artifact, repository, chat, CI log or cloud development environment.
A public certificate and its SHA-256 fingerprint may be published.

Keep the same application ID and signing key for updates. Android will reject an
update with a different signer. Losing the key can prevent updates to existing
installations. CI rebuilds the extracted source archive without Git metadata and uses a
disposable **test-only** key to exercise the signing script; that key and the APK it signs are deleted and are never release assets.

## Version policy

The next candidate takes its version from [android/release.properties](../android/release.properties).

- versionName: 1.0.0
- versionCode: 5
- stable tag: v1.0.0
- previous public version: v0.1.0-android-preview.3 (versionCode 4)
- package: io.github.kuba25x.upscalecompare
- minimum API 24; target/compile API 36

Increase versionCode for **every distributed release**, including replacement
previews. Never reuse or decrement a published code. Use a strictly increasing
integer up to 2,100,000,000. Set the tag to v followed by versionName. Version
changes are reviewed in a PR before building the candidate. Debug builds use the
same version metadata but retain debug signing and the existing workflow.

## Windows 11 support

Follow [native Windows 11 / PowerShell signing](ANDROID_WINDOWS_SIGNING.md) for
setup, NTFS permissions, hidden password prompts and exact verification commands.
WSL2 is optional. Linux/macOS commands continue below; all platforms retain the
same package, source, hash, signature and certificate checks.

## One-time owner setup — trusted computer only

1. Choose the long-term release-signing computer or offline signing workstation.
   Install a trusted JDK 21 and Android SDK Build Tools 35.0.0; record their
   versions. The helper supports Windows 11 and Linux/macOS with Node 24, a full
   JDK 21 and SDK binaries. It uses JDK ZipFile and system tar instead of unzip.
   It does not require npm install to sign.
2. Create a private directory **outside every repository and synchronized folder**,
   set restrictive permissions, and generate the permanent key there. These
   commands deliberately prompt for passwords rather than putting them in
   shell history or process arguments:

   ```sh
   umask 077
   mkdir -p /path/to/private-signing
   keytool -genkeypair \
     -keystore /path/to/private-signing/upscale-compare-release.p12 \
     -storetype PKCS12 -alias upscale-compare \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

   Enter the certificate identity and strong password locally. Do not run this
   step in Actions or an untrusted remote workspace. Do not send the result or
   password to anyone assisting with development.

3. Make encrypted recovery backups in separate controlled locations. Store
   recovery instructions and passwords in a trusted password manager. Test
   restoration before the first public release.
4. Inspect/export the **public certificate**, record its fingerprint independently,
   and publish that fingerprint in the eventual release notes and signing policy:

   ```sh
   keytool -list -v \
     -keystore /path/to/private-signing/upscale-compare-release.p12 \
     -alias upscale-compare
   keytool -exportcert -rfc \
     -keystore /path/to/private-signing/upscale-compare-release.p12 \
     -alias upscale-compare \
     -file /path/to/private-signing/upscale-compare-public-certificate.pem
   ```

   The certificate export contains no private key. No placeholder fingerprint
   in this repository is an approved production identity. The owner must choose
   and verify the real fingerprint before signing/distribution.

No GitHub signing secret or environment configuration is required by this model.
If cloud signing is introduced later, review it separately: use a dedicated
protected environment with owner approval, main-only jobs, least-privilege
permissions and a managed signing service or securely provisioned key. Do not
simply add the production key to the debug/PR workflow.

## Build an unsigned candidate

After merging the reviewed preparation changes, run **Android release preparation**
from the Actions page **on main**. Supply the full 40-character reviewed source
commit. The workflow rejects other branches and commits outside main history.
It checks out that exact SHA before dependency installation or building.

PR runs validate their merge commit and produce test candidates. They are not
public release candidates: the final manual main run must pass after merge.
Never label a PR merge SHA as an already released main commit.

The workflow uses the toolchain documented in [ANDROID.md](ANDROID.md). It runs:

```sh
npm ci
npm run test:android:release
npm run android:release:unsigned
node scripts/android-source-bundle.mjs
export SOURCE_COMMIT="$(git rev-parse HEAD)"
node scripts/android-release.mjs prepare release-artifacts/unsigned
node scripts/android-release-smoke.mjs release-artifacts/unsigned
```

On a clean local checkout these commands reproduce the same build procedure.
They pin package/Gradle inputs and record source/signing identity; they do not
promise byte-identical ZIPs across OS/JDK patches, source-server archive metadata
or signing implementations.

Download `upscale-compare-UNSIGNED-<commit>-<attempt>` from the successful
`unsigned-release` job (14-day retention). Older runs omit the attempt suffix.
If only `windows-signing` was rerun, use the attempt of the Linux job that
uploaded the artifact. It includes:

| File                                       | Purpose                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| upscale-compare-<versionName>-unsigned.apk | Non-debuggable APK; not yet installable                                      |
| corresponding-source-<commit>.tar.gz       | Project at that exact commit plus preferred upstream runtime sources         |
| release-manifest.json                      | Package/version, exact SHA, run URL and file SHA-256 values                  |
| COMMIT                                     | Full source SHA                                                              |
| SHA256SUMS                                 | Checksums for the files, manifest and COMMIT                                 |
| LICENSE.txt                                | Unmodified AGPL-3.0 license                                                  |
| THIRD_PARTY_NOTICES.txt                    | Frontend/Capacitor licenses, native inventory and available upstream notices |
| DEPENDENCIES.json                          | Resolved native runtime coordinates, licenses, source/POM locations          |

The source collector fails if an expected upstream archive is unavailable.
It uses reviewed immutable upstream commits pinned in
android/upstream-sources.json, checks the installed package versions and records
download SHA-256 values in DEPENDENCY-SOURCES.json inside the source archive. Native
source JARs are exact Maven versions. Review the inventory when updating any
dependency; an automated mapping is not a substitute for reviewing new licenses
or upstream NOTICE obligations. The npm runtime inventory includes transitive
tslib (0BSD); its source, copyright notice and license are retained.

## Owner verification and offline signing

Review the scripts from the exact source commit **before connecting the key**.
Finish dependency downloads/builds and disconnect networking before signing.
Use a separately verified checkout/copy of scripts/android-release.mjs,
scripts/android-release-tools.mjs and scripts/AndroidReleaseArchive.java. They
use only Node built-ins, the trusted local JDK 21 and SDK. Do not execute scripts obtained solely from an
unverified artifact while the production key is attached.

Unzip the unsigned artifact into a new local directory. Compare its source SHA
and workflow URL against the successful main run and the reviewed commit. Verify
the GitHub artifact download/digest where available. Checksums detect corruption;
a checksum shipped beside an untrusted APK does not independently authenticate it.

```sh
export JAVA_HOME=/path/to/trusted/jdk-21
export ANDROID_HOME=/path/to/trusted/android-sdk
export UC_COMMIT=FULL_40_CHARACTER_REVIEWED_MAIN_SHA
export UC_CERT_SHA256=YOUR_INDEPENDENTLY_VERIFIED_PUBLIC_CERTIFICATE_SHA256

cd /path/to/reviewed/upscale-compare
node scripts/android-release.mjs verify /path/to/unsigned-bundle "$UC_COMMIT"

node scripts/android-release.mjs sign \
  /path/to/unsigned-bundle "$UC_COMMIT" \
  /path/to/private-signing/upscale-compare-release.p12 \
  upscale-compare "$UC_CERT_SHA256" \
  /path/to/new-signed-output

node scripts/android-release.mjs verify \
  /path/to/new-signed-output "$UC_COMMIT" "$UC_CERT_SHA256"
```

Replace the placeholders; commit and certificate fingerprint are public values.
The sign CLI requires an interactive terminal and refuses redirected stdin/stdout.
apksigner prompts for the password locally through the inherited Java console. There are no password flags or
production-password environment variables in this command. The output directory
must be new. If any check fails, do not distribute partial output; inspect the
cause and start with a new output directory.

The helper verifies input hashes before signing, expected package/version,
min/target SDK, debuggable=false, embedded build provenance, license assets and
ZIP alignment. It rejects signed inputs. It requests v2/v3 signing and no v4
sidecar; afterward it verifies the actual APK signature and exact public
certificate fingerprint. The signed manifest records the unsigned APK hash,
signed APK hash, source SHA and signing-certificate SHA-256. SHA256SUMS is
regenerated for the signed distribution. The private key never enters the output.

Independent final checks:

```sh
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify \
  --verbose --print-certs /path/to/new-signed-output/upscale-compare-1.0.0.apk
cd /path/to/new-signed-output
sha256sum -c SHA256SUMS
```

On macOS use shasum -a 256 -c SHA256SUMS. Compare the certificate against the
independent owner record, not just the fingerprint inside the downloaded bundle.

## Device and publication gate

Follow the [v1.0.0 guide](RELEASE_1_0_GUIDE.md) to test the owner-signed APK,
verify its source, tag the tested commit and publish the stable release with all eight assets.

## License and dependency distribution

The project declares **AGPL-3.0-only** in package.json and supplies the full AGPL v3
text in LICENSE. Binary distribution must satisfy section 6 (machine-readable
Corresponding Source, including build/install scripts); a hosted modified service
also has section 13 network-source obligations. Merely naming a repository or
shipping LICENSE is insufficient for binary distribution.

The bundle includes the project, locked dependencies, native source JARs and
upstream frontend/Capacitor source repositories. Their existing MIT, ISC, 0BSD and
Apache-2.0 terms and notices continue to apply. Test/build-only dependencies are
not bundled runtime components. Android/WebView/SDK/JDK are system/build
prerequisites, documented with versions; they are not redistributed inside this APK.

Recipients can build and self-sign a modified APK using their own key. For a
source archive without .git, set SOURCE_COMMIT to the archive's recorded commit
before npm run android:release:unsigned. For modified source, use your own Git
history and source attribution. Install a differently signed build after
uninstalling the official package, or change its application ID. Do not disclose
the production private key. If distributing the software as part of a User
Product or changing installation restrictions, review the license's Installation
Information requirements before that distribution.

## Rebuild and self-sign from the source archive

Extract corresponding-source-<commit>.tar.gz outside any existing Git checkout.
Its project/ directory contains the source, lockfiles, Gradle wrapper and these
instructions. Install the pinned toolchain and accept SDK licenses as described
in ANDROID.md. Initial npm/Gradle dependency downloads require networking.

```sh
cd /path/to/extracted/project
export SOURCE_COMMIT=THE_FULL_COMMIT_FROM_DEPENDENCY_SOURCES_JSON
npm ci
npm run android:release:unsigned
```

The archive has no .git metadata; SOURCE_COMMIT supplies the original attribution
for an unmodified rebuild. For modified source, create your own Git history and
use its actual commit instead. The build does not access a production key.

To install your own rebuild, finish building before making your own trusted
test keystore accessible. Use the interactive keytool procedure above with a
different keystore/alias. Then sign locally with that key:

```sh
"$ANDROID_HOME/build-tools/35.0.0/apksigner" sign \
  --ks /path/to/your-own-test.p12 --ks-key-alias your-test-alias \
  --out /path/to/your-own-rebuild.apk \
  android/app/build/outputs/apk/release/app-release-unsigned.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify \
  --verbose --print-certs /path/to/your-own-rebuild.apk
```

This independent rebuild is not an official signed release. A different signer
requires uninstalling the official package first (deleting its private session),
or building under a different application ID. No producer signing key is needed
to inspect, modify, build or self-sign the source.
