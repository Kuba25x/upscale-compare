// End-to-end signing test with a disposable CI-only key, never a production key.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { checkBadging } from './android-release.mjs';
import { readApkAssets, runTool, tarCommand } from './android-release-tools.mjs';

const originalBundle = resolve(process.argv[2]);
const commit = process.env.SOURCE_COMMIT;
const temporary = mkdtempSync(join(tmpdir(), 'Upscale signing żółć & (test); %! '));
const password = randomBytes(32).toString('hex');
const bundle = join(temporary, 'Unsigned bundle żółć & (test); %!');
cpSync(originalBundle, bundle, { recursive: true });
const key = join(temporary, 'TEST-ONLY.p12');
const signingOnly = process.argv[3] === '--signing-only';
const command = (args, options = {}) => {
  // CI-only library harness: the production CLI refuses piped password input.
  const parameters =
    args[0] === 'sign'
      ? [
          '--input-type=module',
          '--eval',
          "import { signBundle } from './scripts/android-release.mjs'; signBundle(...process.argv.slice(1));",
          ...args.slice(1),
        ]
      : ['scripts/android-release.mjs', ...args];
  return spawnSync(process.execPath, parameters, { encoding: 'utf8', shell: false, ...options });
};
try {
  if (!signingOnly) {
    const extracted = join(temporary, 'source-rebuild');
    mkdirSync(extracted);
    execFileSync(tarCommand(), [
      '-xzf',
      join(bundle, 'corresponding-source-' + commit + '.tar.gz'),
      '-C',
      extracted,
    ]);
    const project = join(extracted, 'project');
    const options = { cwd: project, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 };
    execFileSync('npm', ['ci'], options);
    execFileSync('npm', ['run', 'android:release:unsigned'], options);
    const rebuilt = join(project, 'android/app/build/outputs/apk/release/app-release-unsigned.apk');
    const originalManifest = JSON.parse(
      readFileSync(join(bundle, 'release-manifest.json'), 'utf8'),
    );
    checkBadging(
      runTool('aapt', ['dump', 'badging', rebuilt], {
        encoding: 'utf8',
      }),
      originalManifest,
    );
    const embedded = JSON.parse(readApkAssets(rebuilt)['build-info.json']);
    assert.equal(embedded.commit, commit);
    assert.equal(embedded.versionCode, originalManifest.versionCode);
    assert.equal(embedded.versionName, originalManifest.versionName);
    console.log('PASS: corresponding-source archive rebuild without Git metadata');
  }
  runTool(
    'keytool',
    [
      '-genkeypair',
      '-keystore',
      key,
      '-storetype',
      'PKCS12',
      '-alias',
      'TEST-ONLY',
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '2',
      '-dname',
      'CN=Disposable CI Test Key',
    ],
    { input: password + '\n' + password + '\n' },
  );
  const certificate = runTool(
    'keytool',
    ['-J-Duser.language=en', '-J-Duser.country=US', '-list', '-v', '-keystore', key],
    { input: password + '\n' },
  ).match(/SHA256: ([A-F0-9:]+)/)?.[1];
  assert.ok(certificate);
  const output = join(temporary, 'signed');
  const signed = command(['sign', bundle, commit, key, 'TEST-ONLY', certificate, output], {
    input: password + '\n',
  });
  assert.equal(signed.status, 0, signed.stdout + signed.stderr);
  assert.ok(!signed.stdout.includes(password) && !signed.stderr.includes(password));
  const redirected = spawnSync(
    process.execPath,
    [
      'scripts/android-release.mjs',
      'sign',
      bundle,
      commit,
      key,
      'TEST-ONLY',
      certificate,
      join(temporary, 'redirected'),
    ],
    { encoding: 'utf8', input: password + '\n', shell: false },
  );
  assert.notEqual(redirected.status, 0);
  assert.match(redirected.stderr, /interactive terminal/);
  const verified = command(['verify', output, commit, certificate]);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.notEqual(
    command(['verify', output, commit, '00'.repeat(32)]).status,
    0,
    'Wrong certificate must fail',
  );
  assert.notEqual(
    command(['verify', output, 'a'.repeat(40), certificate]).status,
    0,
    'Wrong commit must fail',
  );
  assert.notEqual(
    command(['sign', output, commit, key, 'TEST-ONLY', certificate, join(temporary, 'repeat')])
      .status,
    0,
    'Signed input must be rejected',
  );
  const wrongCommit = join(temporary, 'wrong-commit-file');
  cpSync(bundle, wrongCommit, { recursive: true });
  writeFileSync(join(wrongCommit, 'COMMIT'), 'b'.repeat(40) + '\n');
  assert.notEqual(
    command(['verify', wrongCommit, commit]).status,
    0,
    'Changed COMMIT sidecar must fail',
  );
  const wrongChecksums = join(temporary, 'wrong-checksums');
  cpSync(bundle, wrongChecksums, { recursive: true });
  writeFileSync(join(wrongChecksums, 'SHA256SUMS'), 'untrusted');
  assert.notEqual(
    command(['verify', wrongChecksums, commit]).status,
    0,
    'Changed checksum sidecar must fail',
  );
  const damaged = join(temporary, 'damaged');
  cpSync(bundle, damaged, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(damaged, 'release-manifest.json'), 'utf8'));
  const apk = Object.keys(manifest.files).find((name) => name.endsWith('.apk'));
  writeFileSync(join(damaged, apk), 'damaged');
  const refused = command([
    'sign',
    damaged,
    commit,
    key,
    'TEST-ONLY',
    certificate,
    join(temporary, 'refused'),
  ]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /SHA-256 mismatch/);
  const signedManifest = JSON.parse(readFileSync(join(output, 'release-manifest.json'), 'utf8'));
  const signedApk = join(
    output,
    Object.keys(signedManifest.files).find((name) => name.endsWith('.apk')),
  );
  runTool('apksigner', ['verify', '--verbose', signedApk], { stdio: 'pipe' });
  console.log(
    'PASS: real APK offline signing, verification, wrong key/commit, signed-input and tampered-byte rejection',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
