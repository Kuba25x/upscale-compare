// End-to-end signing test with a disposable CI-only key, never a production key.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const bundle = resolve(process.argv[2]);
const commit = process.env.SOURCE_COMMIT;
const temporary = mkdtempSync(join(tmpdir(), 'upscale-signing-test-'));
const password = 'disposable-test-only';
const key = join(temporary, 'TEST-ONLY.p12');
const sdk = process.env.ANDROID_HOME;
const apksigner = join(sdk, 'build-tools/35.0.0/apksigner');
const command = (args, options = {}) => spawnSync(process.execPath, ['scripts/android-release.mjs', ...args], { encoding: 'utf8', ...options });
try {
  execFileSync('keytool', ['-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-alias', 'TEST-ONLY',
    '-storepass', password, '-keypass', password, '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '2', '-dname', 'CN=Disposable CI Test Key'], { stdio: 'pipe' });
  const certificate = execFileSync('keytool', ['-list', '-v', '-keystore', key, '-storepass', password], { encoding: 'utf8', env: { ...process.env, JAVA_TOOL_OPTIONS: '-Duser.language=en' } })
    .match(/SHA256: ([A-F0-9:]+)/)?.[1];
  assert.ok(certificate);
  const output = join(temporary, 'signed');
  const signed = command(['sign', bundle, commit, key, 'TEST-ONLY', certificate, output], { input: password + '\n' });
  assert.equal(signed.status, 0, signed.stdout + signed.stderr);
  const verified = command(['verify', output, commit, certificate]);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.notEqual(command(['verify', output, commit, '00'.repeat(32)]).status, 0, 'Wrong certificate must fail');
  assert.notEqual(command(['verify', output, 'a'.repeat(40), certificate]).status, 0, 'Wrong commit must fail');
  assert.notEqual(command(['sign', output, commit, key, 'TEST-ONLY', certificate, join(temporary, 'repeat')]).status, 0, 'Signed input must be rejected');
  const wrongCommit = join(temporary, 'wrong-commit-file');
  cpSync(bundle, wrongCommit, { recursive: true });
  writeFileSync(join(wrongCommit, 'COMMIT'), 'b'.repeat(40) + '\n');
  assert.notEqual(command(['verify', wrongCommit, commit]).status, 0, 'Changed COMMIT sidecar must fail');
  const wrongChecksums = join(temporary, 'wrong-checksums');
  cpSync(bundle, wrongChecksums, { recursive: true });
  writeFileSync(join(wrongChecksums, 'SHA256SUMS'), 'untrusted');
  assert.notEqual(command(['verify', wrongChecksums, commit]).status, 0, 'Changed checksum sidecar must fail');
  const damaged = join(temporary, 'damaged');
  cpSync(bundle, damaged, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(damaged, 'release-manifest.json'), 'utf8'));
  const apk = Object.keys(manifest.files).find((name) => name.endsWith('.apk'));
  writeFileSync(join(damaged, apk), 'damaged');
  const refused = command(['sign', damaged, commit, key, 'TEST-ONLY', certificate, join(temporary, 'refused')]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /SHA-256 mismatch/);
  const signedManifest = JSON.parse(readFileSync(join(output, 'release-manifest.json'), 'utf8'));
  const signedApk = join(output, Object.keys(signedManifest.files).find((name) => name.endsWith('.apk')));
  execFileSync(apksigner, ['verify', '--verbose', signedApk], { stdio: 'pipe' });
  console.log('PASS: real APK offline signing, verification, wrong key/commit, signed-input and tampered-byte rejection');
} finally { rmSync(temporary, { recursive: true, force: true }); }
