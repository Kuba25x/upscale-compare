// Android release preparation and offline signing. Never accepts passwords as arguments.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const applicationId = 'io.github.kuba25x.upscalecompare';
export function readVersion(text) {
  const fields = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((s) => s.trim() && !s.trim().startsWith('#'))
      .map((s) => s.split('=')),
  );
  if (
    !/^[1-9][0-9]{0,9}$/.test(fields.versionCode || '') ||
    Number(fields.versionCode) > 2100000000 ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(fields.versionName || '')
  ) {
    throw new Error('Invalid Android release version');
  }
  return { versionCode: Number(fields.versionCode), versionName: fields.versionName };
}
export function requireCommit(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || ''))
    throw new Error('A full lowercase source commit SHA is required');
  return commit;
}
export function fingerprint(value) {
  const normalized = (value || '').replaceAll(':', '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized))
    throw new Error('A SHA-256 signing certificate fingerprint is required');
  return normalized;
}
export function checkBadging(text, version) {
  const line = text.split('\n').find((s) => s.startsWith('package: ')) || '';
  if (
    !line.includes("name='" + applicationId + "'") ||
    !line.includes("versionCode='" + version.versionCode + "'") ||
    !line.includes("versionName='" + version.versionName + "'") ||
    text.includes('application-debuggable') ||
    !text.includes("sdkVersion:'24'") ||
    !text.includes("targetSdkVersion:'36'")
  ) {
    throw new Error('APK package, version, SDK or debuggable policy mismatch');
  }
}
export function checkSignature(text, expected) {
  const certs = [...text.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)/g)];
  if (
    certs.length !== 1 ||
    fingerprint(certs[0][1]) !== fingerprint(expected) ||
    !text.includes('Verified using v2 scheme (APK Signature Scheme v2): true')
  ) {
    throw new Error('APK signing certificate or v2 signature mismatch');
  }
}
export function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function tool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Set ANDROID_HOME to the trusted Android SDK');
  const path = join(sdk, 'build-tools', '35.0.0', name);
  if (!existsSync(path)) throw new Error('Missing Android Build Tools 35.0.0: ' + name);
  return path;
}
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
function apkPolicy(apk, manifest) {
  checkBadging(run(tool('aapt'), ['dump', 'badging', apk]), manifest);
  const build = JSON.parse(run('unzip', ['-p', apk, 'assets/public/build-info.json']));
  if (
    build.commit !== manifest.commit ||
    build.source !== manifest.source ||
    build.versionCode !== manifest.versionCode ||
    build.versionName !== manifest.versionName
  ) {
    throw new Error('Embedded APK build provenance mismatch');
  }
  for (const name of ['LICENSE.txt', 'third-party-licenses.txt']) {
    if (run('unzip', ['-p', apk, 'assets/public/' + name]).length < 1000) {
      throw new Error('Missing embedded license notices');
    }
  }
}
export function validateManifest(manifest, commit) {
  requireCommit(commit);
  if (
    manifest.schema !== 1 ||
    manifest.commit !== commit ||
    manifest.applicationId !== applicationId ||
    manifest.source !== 'https://github.com/Kuba25x/upscale-compare/tree/' + commit ||
    !['unsigned', 'signed'].includes(manifest.kind)
  ) {
    throw new Error('Unexpected release manifest or source commit');
  }
  readVersion('versionCode=' + manifest.versionCode + '\nversionName=' + manifest.versionName);
  if (!manifest.files || Object.keys(manifest.files).length < 4)
    throw new Error('Incomplete release bundle');
  const stem = 'upscale-compare-' + manifest.versionName;
  const expected = [
    stem + (manifest.kind === 'unsigned' ? '-unsigned.apk' : '.apk'),
    'corresponding-source-' + commit + '.tar.gz',
    'LICENSE.txt',
    'THIRD_PARTY_NOTICES.txt',
    'DEPENDENCIES.json',
  ].sort();
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(expected)) {
    throw new Error('Unexpected release bundle file list');
  }
  for (const [name, sha] of Object.entries(manifest.files)) {
    if (basename(name) !== name || !/^[a-f0-9]{64}$/.test(sha))
      throw new Error('Unsafe bundle entry');
  }
}
function verifyBundle(directory, commit, certificate) {
  const manifest = JSON.parse(readFileSync(join(directory, 'release-manifest.json'), 'utf8'));
  validateManifest(manifest, commit);
  for (const [name, sha] of Object.entries(manifest.files)) {
    if (hash(join(directory, name)) !== sha) throw new Error('SHA-256 mismatch: ' + name);
  }
  if (readFileSync(join(directory, 'COMMIT'), 'utf8').trim() !== commit)
    throw new Error('COMMIT provenance mismatch');
  const checksumNames = [...Object.keys(manifest.files), 'release-manifest.json', 'COMMIT'];
  const checksums =
    checksumNames.map((name) => hash(join(directory, name)) + '  ' + name).join('\n') + '\n';
  if (readFileSync(join(directory, 'SHA256SUMS'), 'utf8') !== checksums)
    throw new Error('SHA256SUMS mismatch');
  const sourceName = 'corresponding-source-' + commit + '.tar.gz';
  const source = JSON.parse(
    run('tar', ['-xOf', join(directory, sourceName), './DEPENDENCY-SOURCES.json']),
  );
  if (source.commit !== commit || !Array.isArray(source.archives) || source.archives.length < 5) {
    throw new Error('Corresponding-source provenance mismatch');
  }
  const apk = join(
    directory,
    Object.keys(manifest.files).find((name) => name.endsWith('.apk')),
  );
  apkPolicy(apk, manifest);
  run(tool('zipalign'), ['-c', '-P', '16', '4', apk]);
  if (manifest.kind === 'signed') {
    if (fingerprint(manifest.certificateSha256) !== fingerprint(certificate)) {
      throw new Error('Manifest signing certificate mismatch');
    }
    checkSignature(
      run(tool('apksigner'), ['verify', '--verbose', '--print-certs', apk]),
      certificate,
    );
  } else {
    // Reject signed inputs. Verification of an unsigned APK must fail.
    const result = spawnSync(tool('apksigner'), ['verify', apk], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 1 || !result.stderr.includes('DOES NOT VERIFY')) {
      throw new Error('Expected an unsigned APK, not a signed or unreadable input');
    }
  }
  return { manifest, apk };
}
function writeManifest(directory, manifest) {
  writeFileSync(join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const names = [...Object.keys(manifest.files), 'release-manifest.json', 'COMMIT'];
  writeFileSync(
    join(directory, 'SHA256SUMS'),
    names.map((name) => hash(join(directory, name)) + '  ' + name).join('\n') + '\n',
  );
}
function prepare(directory) {
  const commit = requireCommit(run('git', ['rev-parse', 'HEAD']).trim());
  if (commit !== requireCommit(process.env.SOURCE_COMMIT))
    throw new Error('Build commit does not match SOURCE_COMMIT');
  if (run('git', ['status', '--porcelain', '--untracked-files=no']).trim())
    throw new Error('Tracked build inputs changed');
  const version = readVersion(readFileSync('android/release.properties', 'utf8'));
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const apkName = 'upscale-compare-' + version.versionName + '-unsigned.apk';
  copyFileSync(
    'android/app/build/outputs/apk/release/app-release-unsigned.apk',
    join(directory, apkName),
  );
  const sourceName = 'corresponding-source-' + commit + '.tar.gz';
  copyFileSync(join('release-artifacts/source', sourceName), join(directory, sourceName));
  copyFileSync('LICENSE', join(directory, 'LICENSE.txt'));
  copyFileSync('dist-android/third-party-licenses.txt', join(directory, 'THIRD_PARTY_NOTICES.txt'));
  copyFileSync(
    'android/app/build/reports/release-dependencies.json',
    join(directory, 'DEPENDENCIES.json'),
  );
  writeFileSync(join(directory, 'COMMIT'), commit + '\n');
  const manifest = {
    schema: 1,
    kind: 'unsigned',
    applicationId,
    ...version,
    commit,
    source: 'https://github.com/Kuba25x/upscale-compare/tree/' + commit,
    workflowRun: process.env.GITHUB_RUN_ID
      ? 'https://github.com/Kuba25x/upscale-compare/actions/runs/' + process.env.GITHUB_RUN_ID
      : null,
    deviceQualified: false,
    files: Object.fromEntries(
      [apkName, sourceName, 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'DEPENDENCIES.json'].map(
        (name) => [name, hash(join(directory, name))],
      ),
    ),
  };
  writeManifest(directory, manifest);
  verifyBundle(directory, commit);
  console.log('Verified unsigned release bundle for ' + commit);
}
function sign(directory, commit, keystore, alias, certificate, output) {
  const expected = fingerprint(certificate);
  const { manifest, apk } = verifyBundle(directory, commit);
  if (manifest.kind !== 'unsigned') throw new Error('Signing requires a verified unsigned bundle');
  if (!keystore || !alias || !output)
    throw new Error('Keystore, alias and new output directory are required');
  mkdirSync(output, { recursive: false, mode: 0o700 });
  const signed = join(output, 'upscale-compare-' + manifest.versionName + '.apk');
  // No Gradle, npm, network operation or password environment variable is used here.
  const result = spawnSync(
    tool('apksigner'),
    [
      'sign',
      '--ks',
      resolve(keystore),
      '--ks-key-alias',
      alias,
      '--v1-signing-enabled',
      'false',
      '--v2-signing-enabled',
      'true',
      '--v3-signing-enabled',
      'true',
      '--v4-signing-enabled',
      'false',
      '--out',
      signed,
      apk,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Signing failed; do not distribute partial output');
  checkSignature(
    run(tool('apksigner'), ['verify', '--verbose', '--print-certs', signed]),
    expected,
  );
  for (const name of Object.keys(manifest.files).filter((name) => !name.endsWith('.apk'))) {
    copyFileSync(join(directory, name), join(output, name));
  }
  copyFileSync(join(directory, 'COMMIT'), join(output, 'COMMIT'));
  const files = Object.fromEntries(
    Object.keys(manifest.files)
      .filter((name) => !name.endsWith('.apk'))
      .map((name) => [name, hash(join(output, name))]),
  );
  files[basename(signed)] = hash(signed);
  writeManifest(output, {
    ...manifest,
    kind: 'signed',
    certificateSha256: expected,
    unsignedApkSha256: hash(apk),
    files,
  });
  verifyBundle(output, commit, expected);
  console.log('Verified signed release bundle: ' + output);
}
export function main(args) {
  const [command, directory, commit, ...rest] = args;
  if (command === 'prepare' && directory) return prepare(resolve(directory));
  if (command === 'verify' && directory && commit) {
    verifyBundle(resolve(directory), commit, rest[0]);
    console.log('Release bundle verified for ' + commit);
    return;
  }
  if (command === 'sign' && directory && commit) return sign(resolve(directory), commit, ...rest);
  throw new Error(
    'Usage: android-release.mjs prepare DIR | verify DIR COMMIT [CERT_SHA256] | sign DIR COMMIT KEYSTORE ALIAS CERT_SHA256 NEW_OUTPUT_DIR',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
