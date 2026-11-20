# Publish an Android Preview

The [Publish Android Preview workflow](https://github.com/Kuba25x/upscale-compare/actions/workflows/android-preview.yml) distributes the tested debug APK as a GitHub pre-release. It uses Gradle's disposable debug key on a fresh GitHub runner. No signing secret, custom token, or production key is required.

## One-time repository setup

1. Protect `main` with a branch rule or ruleset that requires reviewed pull requests. Apply the rule to administrators as well. Publication requires a protected `main` and the exact reviewed commit.
2. In **Settings → Environments**, create `android-preview`. Add **Required reviewers** and allow deployments only from the `main` branch. Disable administrator bypass. If you have another release reviewer, enable **Prevent self-review**. A sole maintainer can leave self-review enabled and approve the job separately after inspecting the build.
3. Keep workflow changes subject to review. The publishing job checks the GitHub approval history and refuses to write if it does not find a reviewer approval for `android-preview`, even if the environment was created without protection rules.

## Build, review, and publish

1. Increase `versionCode` and set a new preview `versionName` in [android/release.properties](../android/release.properties) through a PR. For example, set `0.1.0-android-preview.2` with a code greater than the previous release's code. Merge the reviewed version change before dispatching.
2. Open **Actions → Publish Android Preview → Run workflow**. Select `main`, paste its full reviewed commit SHA, and enter the tag `v` followed by the version name. Leave **publish** off to build and test a rehearsal. Turn it on to request publication after approval.
3. Check the Android browser, JVM, lint, and API 36 emulator results. Download the `android-preview-candidate-…` artifact from this run to inspect or try the exact APK. The package, version, commit, debug signature, source archive, licenses and checksums are checked before upload.
4. For a publication run, use **Review deployments** to approve `android-preview` on that run after checking the commit and candidate. If `main` changed, dispatch again with the new reviewed tip. Dispatch a fresh run after a failure instead of using **Re-run jobs**.

The workflow creates a new tag at the reviewed commit and uploads the APK, `SHA256SUMS`, `COMMIT`, corresponding-source archive, license, third-party notices and dependency inventory to a draft. It makes the draft a public pre-release only after verifying the uploaded assets. Keep the corresponding-source archive and notices attached alongside the APK.

To rebuild the debug APK with the bundled notices, extract the corresponding-source archive and follow the [Android build guide](ANDROID.md#reproducible-toolchain-and-build) from its `project/` directory. Set `SOURCE_COMMIT` to the SHA in `COMMIT` and `ORG_GRADLE_PROJECT_previewDistribution=true` before running `npm run android:apk`. Gradle generates a local debug key, so the rebuilt APK has its own signature.

An existing tag or release, including a draft, blocks publication. If a run stops after reserving a tag or creating a draft, inspect those entries in GitHub before choosing a new version or manually resolving the failed attempt. The workflow never moves an existing tag or resumes a draft from an earlier run.

Disposable debug keys can prevent in-place updates between builds. Keep your source screenshots outside the app. Uninstalling an earlier build deletes its private comparison and copies. See the [separate signing runbook](ANDROID_RELEASE.md) for future owner-signed builds.
