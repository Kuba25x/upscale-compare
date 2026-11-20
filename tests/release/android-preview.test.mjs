import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBadging, hash } from '../../scripts/android-release.mjs';
import {
  apkName,
  repository,
  validateTag,
  verifyPreviewFiles,
} from '../../scripts/android-preview-bundle.mjs';
import {
  publishPreview,
  requirePublicationContext,
} from '../../scripts/android-preview-publish.mjs';

const commit = 'a'.repeat(40);
const tag = 'v0.1.0-android-preview.2';
const version = { versionName: tag.slice(1), versionCode: 3 };
const env = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: repository,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REF_PROTECTED: 'true',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_RUN_ID: '123',
  GITHUB_SHA: commit,
  SOURCE_COMMIT: commit,
};
const review = {
  state: 'approved',
  user: { login: 'maintainer' },
  environments: [{ name: 'android-preview' }],
};
const tagPath = `/git/ref/tags/${tag}`;

function candidate(t) {
  const directory = mkdtempSync(join(tmpdir(), 'upscale-preview-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const names = [
    apkName,
    `corresponding-source-${commit}.tar.gz`,
    'COMMIT',
    'DEPENDENCIES.json',
    'LICENSE.txt',
    'THIRD_PARTY_NOTICES.txt',
  ];
  for (const name of names)
    writeFileSync(join(directory, name), name === 'COMMIT' ? `${commit}\n` : name);
  const checksum = join(directory, 'SHA256SUMS');
  writeFileSync(
    checksum,
    names.map((name) => `${hash(join(directory, name))}  ${name}\n`).join(''),
  );
  return { env, tag, version, directory, checksumDigest: hash(checksum) };
}

function github(candidate, options = {}) {
  const writes = [];
  let ref = options.ref;
  const api = async (path, { method = 'GET', json, bytes } = {}) => {
    if (method !== 'GET') writes.push({ path, method, json });
    if (path === '/actions/runs/123/approvals') return options.reviews ?? [review];
    if (path === '/branches/main')
      return options.branch ?? { protected: true, commit: { sha: commit } };
    if (path === tagPath) return ref ?? null;
    if (path.startsWith('/releases?')) return options.releases ?? [];
    if (path === '/git/refs') {
      if (options.refConflict) throw new Error('Tag already exists');
      assert.deepEqual(json, { ref: `refs/tags/${tag}`, sha: commit });
      ref = { object: { sha: commit, type: 'commit' } };
      return ref;
    }
    if (path === '/releases') return { id: 8, draft: true, prerelease: true, tag_name: tag };
    if (path.startsWith('/releases/8/assets?')) {
      const name = new URLSearchParams(path.split('?')[1]).get('name');
      const file = join(candidate.directory, name);
      assert.deepEqual(bytes, readFileSync(file));
      return {
        name,
        size: bytes.length,
        state: 'uploaded',
        digest: `sha256:${options.corruptUpload ? '0'.repeat(64) : hash(file)}`,
      };
    }
    if (path === '/releases/8' && method === 'PATCH') return { ...json, tag_name: tag };
    assert.fail(`Unexpected GitHub request: ${method} ${path}`);
  };
  return { api, writes };
}

test('publication requires fresh manual dispatch for the exact protected main commit', () => {
  requirePublicationContext(env);
  for (const change of [
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REPOSITORY: 'fork/upscale-compare' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REF: 'refs/tags/main' },
    { GITHUB_REF_PROTECTED: 'false' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { SOURCE_COMMIT: 'b'.repeat(40) },
    { SOURCE_COMMIT: 'abcdef' },
  ]) {
    assert.throws(() => requirePublicationContext({ ...env, ...change }));
  }
});

test('tag must exactly match a valid preview version and debug badging is opt-in', () => {
  validateTag(tag, version);
  for (const value of ['v0.1.0', 'v0.1.0-android-preview.1', `${tag}\n`, `${tag}/foo`, `-x`]) {
    assert.throws(() => validateTag(value, version));
  }
  const badging = [
    "package: name='io.github.kuba25x.upscalecompare' versionCode='3' versionName='0.1.0-android-preview.2'",
    "sdkVersion:'24'",
    "targetSdkVersion:'36'",
  ].join('\n');
  checkBadging(badging, version);
  checkBadging(`${badging}\napplication-debuggable`, version, true);
  assert.throws(() => checkBadging(`${badging}\napplication-debuggable`, version));
  assert.throws(() => checkBadging(badging, version, true));
});

test('bundle verifies all asset names, bytes and the producing job checksum', (t) => {
  const { directory, checksumDigest } = candidate(t);
  assert.equal(verifyPreviewFiles(directory, commit, checksumDigest).length, 7);
  assert.throws(() => verifyPreviewFiles(directory, commit, '0'.repeat(64)), /integrity/);
  writeFileSync(join(directory, 'debug.keystore'), 'extra');
  assert.throws(() => verifyPreviewFiles(directory, commit, checksumDigest), /asset/);
  rmSync(join(directory, 'debug.keystore'));
  writeFileSync(join(directory, 'LICENSE.txt'), 'modified');
  assert.throws(() => verifyPreviewFiles(directory, commit, checksumDigest), /integrity/);
});

test(
  'bundle rejects missing files and symlinks before publication',
  { skip: process.platform === 'win32' },
  (t) => {
    const { directory, checksumDigest } = candidate(t);
    rmSync(join(directory, 'LICENSE.txt'));
    assert.throws(() => verifyPreviewFiles(directory, commit, checksumDigest), /asset/);
    symlinkSync(join(directory, 'COMMIT'), join(directory, 'LICENSE.txt'));
    assert.throws(
      () => verifyPreviewFiles(directory, commit, checksumDigest),
      /Invalid preview asset/,
    );
  },
);

test('missing, rejected or unrelated environment approval prevents any write', async (t) => {
  const options = candidate(t);
  for (const reviews of [
    [],
    [{ ...review, state: 'rejected' }],
    [{ ...review, environments: [{ name: 'staging' }] }],
    [{ ...review, user: null }],
  ]) {
    const { api, writes } = github(options, { reviews });
    await assert.rejects(publishPreview(api, options), /reviewer approval/);
    assert.deepEqual(writes, []);
  }
});

test('changed or unprotected main and existing tags or drafts prevent any write', async (t) => {
  const options = candidate(t);
  for (const settings of [
    { branch: { protected: true, commit: { sha: 'b'.repeat(40) } } },
    { branch: { protected: false, commit: { sha: commit } } },
    { ref: { object: { sha: commit } } },
    { releases: [{ tag_name: tag, draft: true }] },
    { releases: [{ tag_name: tag, draft: false }] },
  ]) {
    const { api, writes } = github(options, settings);
    await assert.rejects(publishPreview(api, options), /main changed|already exists/);
    assert.deepEqual(writes, []);
  }
});

test('tag creation collision ends the run without creating or editing a release', async (t) => {
  const options = candidate(t);
  const { api, writes } = github(options, { refConflict: true });
  await assert.rejects(publishPreview(api, options), /Tag already exists/);
  assert.deepEqual(
    writes.map(({ path }) => path),
    ['/git/refs'],
  );
});

test('failed asset verification leaves the new release unpublished', async (t) => {
  const options = candidate(t);
  const { api, writes } = github(options, { corruptUpload: true });
  await assert.rejects(publishPreview(api, options), /asset verification failed/);
  assert.equal(writes[1].json.draft, true);
  assert.equal(writes.filter(({ method }) => method === 'PATCH').length, 0);
});

test('approval publishes only the new draft after all seven assets are confirmed', async (t) => {
  const options = candidate(t);
  const { api, writes } = github(options);
  const url = await publishPreview(api, options);
  assert.equal(url, `https://github.com/${repository}/releases/tag/${tag}`);
  assert.deepEqual(
    writes.slice(0, 2).map(({ path }) => path),
    ['/git/refs', '/releases'],
  );
  assert.equal(writes[1].json.target_commitish, commit);
  assert.equal(writes[1].json.draft, true);
  assert.equal(new Set(writes.slice(2, -1).map(({ path }) => path)).size, 7);
  assert.deepEqual(writes.at(-1), {
    path: '/releases/8',
    method: 'PATCH',
    json: { draft: false, prerelease: true, make_latest: 'false' },
  });
});
