import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readVersion, requireCommit } from './android-release.mjs';
import {
  repository,
  validateTag,
  verifyPreviewFiles,
  versionFile,
} from './android-preview-bundle.mjs';

const environment = 'android-preview';

export function requirePublicationContext(env) {
  if (
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REF_PROTECTED !== 'true' ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || '') ||
    requireCommit(env.SOURCE_COMMIT) !== env.GITHUB_SHA
  ) {
    throw new Error(
      'Publication requires a fresh manual run from the reviewed, protected main commit',
    );
  }
}

async function assertMain(api, commit) {
  const branch = await api('/branches/main');
  if (branch.protected !== true || branch.commit?.sha !== commit) {
    throw new Error('Protected main changed or is unprotected. Dispatch a new reviewed run.');
  }
}

async function assertNoRelease(api, tag) {
  for (let page = 1; ; page++) {
    const releases = await api(`/releases?per_page=100&page=${page}`);
    if (releases.some((release) => release.tag_name === tag)) {
      throw new Error(`A release or draft already exists for ${tag}`);
    }
    if (releases.length < 100) return;
  }
}

export async function publishPreview(api, { env, tag, version, directory, checksumDigest }) {
  requirePublicationContext(env);
  validateTag(tag, version);
  const commit = env.SOURCE_COMMIT;
  const runId = env.GITHUB_RUN_ID;
  const reviews = await api(`/actions/runs/${runId}/approvals`);
  if (
    !reviews.some(
      (review) =>
        review.state === 'approved' &&
        review.user?.login &&
        review.environments?.some(({ name }) => name === environment),
    )
  ) {
    throw new Error(`A recorded reviewer approval for ${environment} is required`);
  }
  const files = verifyPreviewFiles(directory, commit, checksumDigest);
  const tagPath = `/git/ref/tags/${tag}`;
  await assertMain(api, commit);
  if (await api(tagPath, { allowMissing: true })) throw new Error(`Tag already exists: ${tag}`);
  await assertNoRelease(api, tag);

  // Ref creation is atomic. An existing tag returns an error instead of being moved.
  await api('/git/refs', { method: 'POST', json: { ref: `refs/tags/${tag}`, sha: commit } });
  await assertNoRelease(api, tag);
  const runURL = `https://github.com/${repository}/actions/runs/${runId}`;
  const draft = await api('/releases', {
    method: 'POST',
    json: {
      tag_name: tag,
      target_commitish: commit,
      name: `Upscale Compare ${tag}`,
      body: [
        'Android Preview for offline screenshot comparison. Download the debug APK and open it on Android to install.',
        'Each build uses a disposable debug signing key. Android may require removing an older build before installing this one. Removing it clears its local comparison.',
        `Source commit: [${commit}](https://github.com/${repository}/tree/${commit}).`,
        `Build and tests: [Actions run ${runId}](${runURL}).`,
        'SHA256SUMS covers the APK and distribution materials below. Use the attached corresponding-source archive for the project and its runtime dependency sources.',
      ].join('\n\n'),
      draft: true,
      prerelease: true,
      make_latest: 'false',
    },
  });
  if (
    !Number.isSafeInteger(draft.id) ||
    draft.id < 1 ||
    draft.tag_name !== tag ||
    !draft.draft ||
    !draft.prerelease
  ) {
    throw new Error('GitHub did not return the requested new draft');
  }
  for (const file of files) {
    const asset = await api(`/releases/${draft.id}/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      bytes: readFileSync(file.path),
    });
    if (
      asset.name !== file.name ||
      asset.state !== 'uploaded' ||
      asset.size !== file.size ||
      asset.digest !== `sha256:${file.sha256}`
    ) {
      throw new Error(`GitHub asset verification failed: ${file.name}`);
    }
  }
  await assertMain(api, commit);
  const ref = await api(tagPath);
  if (ref.object?.type !== 'commit' || ref.object.sha !== commit) {
    throw new Error('The new preview tag does not point to the reviewed commit');
  }
  const release = await api(`/releases/${draft.id}`, {
    method: 'PATCH',
    json: { draft: false, prerelease: true, make_latest: 'false' },
  });
  if (release.draft !== false || release.prerelease !== true || release.tag_name !== tag) {
    throw new Error('GitHub did not confirm publication of the requested preview');
  }
  return `https://github.com/${repository}/releases/tag/${tag}`;
}

function githubApi(token) {
  if (!token) throw new Error('GitHub publication token is unavailable');
  return async (path, { method = 'GET', json, bytes, allowMissing = false } = {}) => {
    const host = bytes ? 'uploads.github.com' : 'api.github.com';
    const response = await fetch(`https://${host}/repos/${repository}${path}`, {
      method,
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': bytes ? 'application/octet-stream' : 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: bytes || (json ? JSON.stringify(json) : undefined),
      signal: AbortSignal.timeout(120_000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status})`);
    return response.json();
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const env = process.env;
  const version = readVersion(readFileSync(versionFile, 'utf8'));
  requirePublicationContext(env);
  validateTag(env.PREVIEW_TAG, version);
  if (process.argv[2] === 'publish') {
    const url = await publishPreview(githubApi(env.GH_TOKEN), {
      env,
      tag: env.PREVIEW_TAG,
      version,
      directory: resolve(process.argv[3]),
      checksumDigest: env.PREVIEW_CHECKSUM_DIGEST,
    });
    console.log(`Published ${url}`);
  } else if (process.argv[2] !== 'preflight') {
    throw new Error('Expected preflight or publish');
  }
}
