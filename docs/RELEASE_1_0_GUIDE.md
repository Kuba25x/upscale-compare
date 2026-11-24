# Publish Upscale Compare v1.0.0 from Windows 11

Use one interactive Windows Terminal PowerShell session on your trusted computer. Commands below use a local, writable NTFS D: drive. Keep the work and key folders outside repositories and cloud synchronization. Install Git and a current GitHub CLI first. Sign in with `gh auth login` as the maintainer on the networked side of this procedure. The private key is needed only during the offline steps.

## 1. Merge the reviewed changes

Open [preparation PR #60](https://github.com/Kuba25x/upscale-compare/pull/60). Review its diff, approvals and required checks, including Android release preparation on Linux and Windows. Use the repository's normal protected merge button once checks pass. Confirm PRs #58 and #59 have also merged before dispatching the final build. A PR artifact is only a rehearsal.

## 2. Pin the final main commit

Start in a fresh work directory. The PR lookup below checks that all three merge commits are included in the selected main history.

```powershell
$ErrorActionPreference = 'Stop'
function Check([string]$operation) { if ($LASTEXITCODE -ne 0) { throw "$operation failed ($LASTEXITCODE)" } }
$repo = 'Kuba25x/upscale-compare'
$work = 'D:\UpscaleRelease-1.0.0'
if (Test-Path $work) { throw 'Choose a fresh work directory.' }
New-Item -ItemType Directory $work | Out-Null
$src = Join-Path $work 'source'
git clone --config core.autocrlf=false "https://github.com/$repo.git" $src
Check 'clone'
Set-Location -LiteralPath $src
git fetch origin main --tags
Check 'fetch main'
$sha = git rev-parse origin/main
Check 'read main SHA'
if ($sha -cnotmatch '^[0-9a-f]{40}$') { throw 'Invalid commit' }
foreach ($pr in @(58,59,60)) {
  $merge = gh pr view $pr --repo $repo --json mergeCommit --jq '.mergeCommit.oid'
  Check "read PR $pr"
  if (!$merge) { throw "PR $pr has not merged" }
  git merge-base --is-ancestor $merge $sha
  Check "PR $pr included in main"
}
git checkout --detach $sha
Check 'checkout reviewed source'
Get-Content android/release.properties
$sha
```

Require versionName 1.0.0 and versionCode 5. Review the three signing helpers in scripts (android-release.mjs, android-release-tools.mjs and AndroidReleaseArchive.java) at this SHA.

## 3. Build the unsigned candidate

```powershell
gh workflow run android-release.yml --repo $repo --ref main -f "source_commit=$sha"
Check 'dispatch Android release preparation'
gh run list --repo $repo --workflow android-release.yml --event workflow_dispatch --branch main --limit 5
Check 'list runs'
$run = Read-Host 'Run ID of the manual dispatch you just started'
if ($run -notmatch '^\d+$') { throw 'Invalid run ID' }
gh run watch $run --repo $repo --exit-status
Check 'release workflow including Windows signing rehearsal'
```

Use **Android release preparation**. Both jobs must succeed, including the source rebuild and disposable-key signing. Record the run URL.

## 4. Download and extract the exact artifact

```powershell
$bundle = Join-Path $work 'unsigned'
$output = Join-Path $work 'signed'
gh run download $run --repo $repo --name "upscale-compare-UNSIGNED-$sha" --dir $bundle
Check 'download and extract unsigned artifact'
$m = Get-Content -Raw (Join-Path $bundle 'release-manifest.json') | ConvertFrom-Json
if ($m.kind -ne 'unsigned' -or $m.commit -cne $sha -or $m.versionName -cne '1.0.0' -or $m.versionCode -ne 5 -or $m.workflowRun -ne "https://github.com/$repo/actions/runs/$run") { throw 'Wrong release candidate' }
```

The CLI extracts the ZIP. With the Actions UI, download the artifact with the same exact name and use `Expand-Archive -LiteralPath $zip -DestinationPath $bundle` instead, with $zip set to the downloaded file. COMMIT and the manifest must be directly inside $bundle. Ignore the reports artifact.

## 5. Check the Windows signing tools

Install trusted Node 24.19.0, a full JDK 21, Android SDK Build Tools 35.0.0 and Platform Tools. Set JAVA_HOME and ANDROID_HOME to their actual installation directories before continuing. Use ASCII paths for the reviewed scripts and initial key setup.

```powershell
if ((node --version) -ne 'v24.19.0') { throw 'Install Node 24.19.0' }
$jdk = Join-Path $env:JAVA_HOME 'bin'
$bt = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0'
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
foreach ($path in @("$jdk\java.exe","$jdk\javac.exe","$jdk\keytool.exe","$bt\aapt.exe","$bt\zipalign.exe","$bt\lib\apksigner.jar","$env:SystemRoot\System32\tar.exe",$adb)) {
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing $path" }
}
& "$jdk\javac.exe" -version
Check 'JDK version (require 21)'
node scripts/android-release.mjs verify $bundle $sha
Check 'unsigned bundle verification'
```

Review the license, third-party notices and dependencies, and inspect the corresponding-source archive. Confirm the source rebuild passed in the selected run. Disconnect networking before making the production key accessible. Use a regular interactive console with transcripts and recordings off.

## 6. Select or generate the permanent key locally

If you already have the permanent key, set $key to its full local path and $alias to its existing alias. Skip generation. Otherwise run this block once on the trusted offline Windows machine. Keep an encrypted recovery copy separately and test restoration. Losing this identity prevents ordinary updates.

```powershell
$keyDir = 'D:\UpscaleSigning'
if (Test-Path $keyDir) { throw 'Inspect existing keys before choosing a fresh private directory.' }
New-Item -ItemType Directory $keyDir | Out-Null
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& "$env:SystemRoot\System32\icacls.exe" $keyDir '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'
Check 'restrict key directory'
$key = Join-Path $keyDir 'upscale-compare-release.p12'
$alias = 'upscale-compare'
& "$jdk\keytool.exe" -genkeypair -keystore $key -storetype PKCS12 -alias $alias -keyalg RSA -keysize 4096 -validity 10000
Check 'key generation'
```

Enter passwords only at the hidden local prompts. Keep them in your password manager.

## 7. Record and verify the public identity

```powershell
& "$jdk\keytool.exe" -list -v -keystore $key -alias $alias
Check 'list public certificate'
$cert = ((Read-Host 'SHA-256 fingerprint from your independent owner record') -replace '[:\s]','').ToLowerInvariant()
if ($cert -notmatch '^[a-f0-9]{64}$') { throw 'Invalid certificate fingerprint' }
$der = Join-Path $work 'public-certificate.der'
& "$jdk\keytool.exe" -exportcert -keystore $key -alias $alias -file $der
Check 'export public certificate'
if ((Get-FileHash $der -Algorithm SHA256).Hash -ne $cert) { throw 'Certificate differs from owner record' }
```

For a new key, record the SHA256 line printed by keytool in a separate trusted record before entering it. For an existing key, use its previously recorded fingerprint.

## 8. Sign and verify offline

```powershell
if (Test-Path $output) { throw 'Choose a fresh signed output path.' }
node scripts/android-release.mjs sign $bundle $sha $key $alias $cert $output
Check 'sign APK'
node scripts/android-release.mjs verify $output $sha $cert
Check 'verify signed APK and distribution'
$apk = Join-Path $output 'upscale-compare-1.0.0.apk'
& "$jdk\java.exe" -jar "$bt\lib\apksigner.jar" verify --verbose --print-certs $apk
Check 'independent SDK signature verification'
$apkHash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$apkHash
```

Confirm v2 and v3 verify and the signer SHA-256 matches $cert. Record the APK digest. Secure the private key and backups before reconnecting. Transfer only public distribution files if publishing from a separate machine.

## 9. Test these signed bytes on a phone

Use the target Xiaomi 15T / Android 16 and the [device checklist](ANDROID.md). Save the original screenshots outside the app and note labels/adjustments first. Uninstall any debug Preview via Android Settings. This erases the app's private data. Enable USB debugging temporarily, authorize the computer and connect one phone.

```powershell
& $adb devices
Check 'list devices'
& $adb install $apk
Check 'install signed stable APK'
& $adb shell dumpsys package io.github.kuba25x.upscalecompare | Select-String 'versionCode=|versionName='
```

Require code 5 and name 1.0.0. Launch offline, import two to four local images via picker and Files, test alignment, A/B swap, both comparison modes, zoom/pan, rotation, system bars and Back. Replace/remove an image, close and reopen offline, and verify the restored comparison. Exercise large originals and cleanup on the target device. With a saved session, run `& $adb install -r $apk` and reopen to check same-signer reinstall and data retention. This first production version has no earlier stable build for a higher-code upgrade test. Test that upgrade on the next release. Record phone/OS/WebView versions, findings, SHA and APK hash. Stop on a blocking failure.

## 10. Tag the tested commit and create a draft

Reconnect after securing the key. From $src, use the tested SHA even if main has advanced. A published v1.0.0 tag must never be moved. If a tag or draft already exists, inspect it before resuming.

```powershell
git tag -a v1.0.0 $sha -m 'Upscale Compare v1.0.0'
Check 'create local tag'
git push origin refs/tags/v1.0.0
Check 'push release tag'
$notes = Join-Path $work 'release-body.md'
$body = [IO.File]::ReadAllText((Join-Path $src 'docs\RELEASE_1_0_NOTES.md'))
$body += "`n`nSource commit: $sha`n`nSigning certificate SHA-256: $cert`n`nAPK SHA-256: $apkHash`n"
[IO.File]::WriteAllText($notes,$body)
gh release create v1.0.0 --repo $repo --verify-tag --draft --title 'Upscale Compare v1.0.0' --notes-file $notes
Check 'create draft stable release'
```

## 11. Upload exactly eight assets

```powershell
$names = @('upscale-compare-1.0.0.apk',"corresponding-source-$sha.tar.gz",'COMMIT','SHA256SUMS','release-manifest.json','LICENSE.txt','THIRD_PARTY_NOTICES.txt','DEPENDENCIES.json')
$assets = @($names | ForEach-Object { Join-Path $output $_ })
node scripts/android-release.mjs verify $output $sha $cert
Check 'final distribution verification'
gh release upload v1.0.0 @assets --repo $repo
Check 'upload signed distribution'
$uploaded = @(gh release view v1.0.0 --repo $repo --json assets --jq '.assets[].name')
Check 'read draft assets'
if (Compare-Object $names $uploaded) { throw 'Draft asset names differ' }
```

Use only the signed output. GitHub's automatic source ZIP/tar links are additional and do not replace the corresponding-source archive. Keep that archive freely available beside the APK. The artifact ZIP, unsigned APK, reports, signing key and recovery files are excluded.

## 12. Publish and check downloads

Review the draft text, fingerprint, tag target and all eight assets in GitHub. Leave **Set as a pre-release** unchecked. Once the phone passes and you approve publication:

```powershell
gh release edit v1.0.0 --repo $repo --draft=false --prerelease=false --latest
Check 'publish stable release'
$download = Join-Path $work 'published'
gh release download v1.0.0 --repo $repo --dir $download
Check 'download published assets'
node scripts/android-release.mjs verify $download $sha $cert
Check 'verify public distribution'
```

Open the README's **Android downloads** link in a signed-out browser. It points to GitHub Releases and will show the latest stable release without a README edit. Check that both APK and corresponding source download. Retain the verified signed files and owner test record.

## 13. Troubleshooting

- **Workflow rejected or missing artifact:** use the manual release preparation workflow on main with a full lowercase SHA from main history. Inspect the first failing step. For a transient upstream source download failure, rerun the failed jobs. If the 14-day artifact expired, dispatch again for the reviewed SHA and repeat verification and phone testing for the newly signed bytes.
- **Wrong commit, checksum, version or notices:** discard the candidate, download the exact SHA-named artifact into an empty directory and verify again. Preserve binary files and line endings. Investigate persistent mismatches before signing.
- **Tools missing or Java launcher fails:** check both environment paths, full JDK 21, Build Tools 35.0.0 and System32 tar. Keep the checkout in a writable ASCII path. See [native Windows diagnostics](ANDROID_WINDOWS_SIGNING.md).
- **Hidden prompt unavailable or signing interrupted:** use Windows Terminal with interactive input/output. Check alias, key path and independent fingerprint. Retry with a fresh output directory.
- **Phone reports incompatible update:** back up original files and uninstall the debug Preview. If a production installation has a different signer, investigate the key before proceeding.
- **Tag, draft or upload already exists:** verify the remote tag resolves to $sha and the draft belongs to this release. Resume at the first unfinished step, uploading only missing verified files. Investigate unexpected assets or a mismatched tag. Keep protections enabled and use an authorized maintainer account. Never replace a published binary under the same version.
