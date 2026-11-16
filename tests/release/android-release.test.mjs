import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVersion, requireCommit, fingerprint, checkBadging, checkSignature } from '../../scripts/android-release.mjs';

test('release versions are explicit and bounded by the Android versionCode ceiling', () => {
  assert.deepEqual(readVersion('# Preview\nversionCode=2\nversionName=0.1.0-android-preview.1\n'), { versionCode: 2, versionName: '0.1.0-android-preview.1' });
  for (const code of ['0', '-1', '2.5', '2100000001', '1e3', '']) {
    assert.throws(() => readVersion('versionCode=' + code + '\nversionName=0.1.0'));
  }
  for (const name of ['', '../preview', '0.1.0 x', '$(command)']) {
    assert.throws(() => readVersion('versionCode=2\nversionName=' + name));
  }
});
test('provenance requires the full source SHA rather than a movable branch or tag', () => {
  assert.equal(requireCommit('a'.repeat(40)), 'a'.repeat(40));
  for (const ref of ['main', 'v0.1.0-android-preview.1', 'abcdef0', 'A'.repeat(40), '']) {
    assert.throws(() => requireCommit(ref));
  }
});
test('certificate fingerprints are public SHA-256 values with optional colons', () => {
  assert.equal(fingerprint(Array(32).fill('AB').join(':')), 'ab'.repeat(32));
  for (const value of ['debug', 'a'.repeat(40), 'a'.repeat(63), 'z'.repeat(64)]) assert.throws(() => fingerprint(value));
});
const version = { versionCode: 2, versionName: '0.1.0-android-preview.1' };
const badging = "package: name='io.github.kuba25x.upscalecompare' versionCode='2' versionName='0.1.0-android-preview.1'\nsdkVersion:'24'\ntargetSdkVersion:'36'\n";
test('release APK must have the expected package/version/SDK and must not be debuggable', () => {
  checkBadging(badging, version);
  for (const text of [badging + 'application-debuggable', badging.replace("versionCode='2'", "versionCode='1'"), badging.replace('upscalecompare', 'upscalecompare.systemuitest'), badging.replace("targetSdkVersion:'36'", "targetSdkVersion:'35'")]) {
    assert.throws(() => checkBadging(text, version));
  }
});
const signature = 'Verified using v2 scheme (APK Signature Scheme v2): true\nSigner #1 certificate SHA-256 digest: ' + 'ab'.repeat(32);
test('signed APK needs a verified v2 signature from exactly the expected certificate', () => {
  checkSignature(signature, 'ab'.repeat(32));
  assert.throws(() => checkSignature(signature, 'cd'.repeat(32)));
  assert.throws(() => checkSignature(signature.replace('true', 'false'), 'ab'.repeat(32)));
  assert.throws(() => checkSignature(signature + '\nSigner #2 certificate SHA-256 digest: ' + 'ab'.repeat(32), 'ab'.repeat(32)));
});
