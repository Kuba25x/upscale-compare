# Native Windows 11 offline signing

Use a regular **Windows Terminal / PowerShell** console (Windows PowerShell 5.1
or PowerShell 7). WSL2 is not required. The unsigned APK is still built on Linux
by the release preparation workflow; this guide covers verification and signing
on the owner's Windows computer. No production key or password goes to Actions.

## Prerequisites and implementation

Install trusted Node 24.19.0, a full **JDK 21 including javac**, and Android SDK
Build Tools **35.0.0** before making the release key accessible. Windows 11 includes
System32/tar.exe, used to read the source archive's provenance without extraction.
There is no unzip, npm install, Gradle, WSL or network dependency while signing.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Your trusted JDK 21'
$env:ANDROID_HOME = 'C:\Android SDK'
& "$env:JAVA_HOME\bin\java.exe" -version
node --version
Test-Path -LiteralPath "$env:JAVA_HOME\bin\javac.exe"
Test-Path -LiteralPath "$env:ANDROID_HOME\build-tools\35.0.0\aapt.exe"
Test-Path -LiteralPath "$env:ANDROID_HOME\build-tools\35.0.0\zipalign.exe"
Test-Path -LiteralPath "$env:ANDROID_HOME\build-tools\35.0.0\lib\apksigner.jar"
Test-Path -LiteralPath "$env:SystemRoot\System32\tar.exe"
```

Replace the example installation paths and require every Test-Path result to be
True. Record tool versions. Review the helper files from the exact trusted source
commit before connecting the key:

- scripts/android-release.mjs
- scripts/android-release-tools.mjs
- scripts/AndroidReleaseArchive.java

The helper invokes java.exe, aapt.exe and zipalign.exe with argument arrays and
shell=false. It launches the official SDK apksigner.jar directly with Java,
without apksigner.bat, cmd.exe, shell interpolation or manually assembled command
strings. Spaces, Unicode and shell metacharacters remain literal path characters.
The Java source-file launcher uses the local JDK compiler; it downloads nothing.
Its bounded ZipFile reader reads only the three public metadata/license entries
and never extracts APK paths onto disk or reads imported screenshots/private keys.

## Key custody and initial setup

If you already have the permanent signing key, keep that identity; switching to
Windows does not require a new key. Otherwise create it **only on your trusted
computer**. Keep it outside repositories, Downloads and OneDrive/other synchronized
folders. Use NTFS permissions, encrypted backups in separate controlled locations
and BitLocker/device encryption for protection of the local disk at rest.

The following creates a **new** directory, removes inherited permissions and
grants access to the current user and SYSTEM. It refuses to overwrite an existing
key directory. Choose another verified local path if LOCALAPPDATA is redirected.
Do not run an elevated shell just to sign APKs.

```powershell
$UCKeyDirectory = Join-Path $env:LOCALAPPDATA 'UpscaleCompareSigning'
if (Test-Path -LiteralPath $UCKeyDirectory) { throw 'Use the existing key or choose a new directory.' }
New-Item -ItemType Directory -Path $UCKeyDirectory -ErrorAction Stop | Out-Null
$UCOwnerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& "$env:SystemRoot\System32\icacls.exe" $UCKeyDirectory '/inheritance:r' '/grant:r' "*${UCOwnerSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict signing directory permissions.' }
$UCKey = Join-Path $UCKeyDirectory 'upscale-compare-release.p12'
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $UCKey -storetype PKCS12 -alias upscale-compare -keyalg RSA -keysize 4096 -validity 10000
if ($LASTEXITCODE -ne 0) { throw 'Key generation failed.' }
```

Answer keytool's prompts locally. Use a strong password kept in your password
manager. Do not put it into a PowerShell variable, command argument, environment
variable, transcript, recording, CI secret or chat. Never use -storepass/-keypass
with a password value. Test encrypted-backup recovery before public distribution.
The key and its backups must remain under your control; the scripts do not upload
or copy the key into the distribution bundle.

Record the **public certificate fingerprint independently**:

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore $UCKey -alias upscale-compare
& "$env:JAVA_HOME\bin\keytool.exe" -exportcert -rfc -keystore $UCKey -alias upscale-compare -file (Join-Path $UCKeyDirectory 'upscale-compare-public-certificate.pem')
```

The exported certificate and its SHA-256 fingerprint are public; the private key
and passwords are not. Retain the same key and alias for subsequent updates.

## Verify, sign and verify again

After the preparation PR is merged, build the reviewed main commit using the
manual workflow described in [ANDROID_RELEASE.md](ANDROID_RELEASE.md). Download
its unsigned artifact, check its Actions run/digest and full source SHA, then use
Expand-Archive to extract the artifact ZIP into a new directory. Do not edit its
manifest, COMMIT, checksum files or line endings. Finish all downloads, review the
scripts and disconnect networking before signing.

These variables contain only **public metadata and local paths**, never passwords:

```powershell
$UCBundle = 'C:\Release Work\Unsigned bundle'
$UCOutput = 'C:\Release Work\New signed output'
$UCCommit = 'FULL_40_CHARACTER_REVIEWED_MAIN_SHA'
$UCCertificate = 'YOUR_INDEPENDENTLY_VERIFIED_PUBLIC_CERTIFICATE_SHA256'
$UCKey = Join-Path $env:LOCALAPPDATA 'UpscaleCompareSigning\upscale-compare-release.p12'
Set-Location -LiteralPath 'C:\Source\reviewed-upscale-compare'

node scripts/android-release.mjs verify $UCBundle $UCCommit
if ($LASTEXITCODE -ne 0) { throw 'Unsigned verification failed.' }
node scripts/android-release.mjs sign $UCBundle $UCCommit $UCKey upscale-compare $UCCertificate $UCOutput
if ($LASTEXITCODE -ne 0) { throw 'Signing failed; do not distribute partial output.' }
node scripts/android-release.mjs verify $UCOutput $UCCommit $UCCertificate
if ($LASTEXITCODE -ne 0) { throw 'Signed verification failed.' }
```

The output directory must not already exist. The production sign command requires
interactive stdin/stdout; redirected input/output and PowerShell ISE are refused.
Java inherits the console and reads the password with its hidden password prompt.
Do not pipe credentials, use Tee-Object/Start-Transcript, redirect streams or launch
through a task runner without a console. First rehearse locally using a separate
throwaway key and confirm that typing the password is not echoed. No password is
read by Node or included in Java's command arguments. Interrupted/failed signing
must not be distributed; inspect the cause and retry in a new output directory.

All existing checks remain: complete bundle SHA-256, exact expected commit,
source-archive provenance, expected package/version/SDK, non-debuggable APK,
embedded build information and exact license texts, alignment, v2 signature and
independently supplied signing-certificate SHA-256. The output includes renewed
SHA256SUMS and a manifest tying the signed APK to the unsigned hash/source commit.
The APK is not recompressed by the verifier; screenshot imports are unchanged.

Independent checks using native tools:

```powershell
$UCAPK = Join-Path $UCOutput 'upscale-compare-0.1.0-android-preview.1.apk'
& "$env:JAVA_HOME\bin\java.exe" -jar "$env:ANDROID_HOME\build-tools\35.0.0\lib\apksigner.jar" verify --verbose --print-certs $UCAPK
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
Get-FileHash -LiteralPath $UCAPK -Algorithm SHA256
Get-Content -LiteralPath (Join-Path $UCOutput 'SHA256SUMS')
```

Compare the APK digest and certificate with the independent owner record. The
Node verify command checks every required bundle file, not only the APK.
A checksum packaged with an untrusted binary does not authenticate its origin;
select the reviewed main run before making the permanent key accessible.

## Automated evidence and limits

The release workflow retains Linux build/source-rebuild/signing tests and adds a
**windows-2025** job running PowerShell, Node 24, JDK 21 and the native SDK. It
verifies the same Linux-generated artifact, signs with an ephemeral test-only key,
checks wrong certificate/commit and tampering rejection, and tests literal paths
with spaces, Polish characters and shell metacharacters. Test passwords are random
and passed only through anonymous stdin pipes to a separate CI library harness;
there is no production CLI bypass flag or production signing secret. The test key
and signed test output are deleted and are never uploaded as release assets.

Windows Server 2025 automation is not a physical Windows 11 console test. Hidden
password entry in your own terminal, NTFS/backup policy and Xiaomi 15T signed-APK
installation/update qualification remain owner checks. Do not generate a production
key in CI or provide it for those automated tests.

WSL2 is an optional fallback if organizational policy prevents using the native
JDK/SDK. It adds a second toolchain and filesystem/backup boundary without changing
the APK signing algorithm. Use the Linux runbook with Linux tools entirely inside
WSL if needed; NTFS permissions still govern files under /mnt/c. Native Windows
support avoids that extra dependency and retains the same official signer and
cryptographic verification. Neither path publishes a Release or creates a tag.
