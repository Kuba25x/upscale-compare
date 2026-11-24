import { setTimeout as wait } from 'node:timers/promises';

const {
  GITHUB_API_URL,
  GITHUB_REPOSITORY,
  GITHUB_RUN_ID,
  GITHUB_SHA,
  GH_TOKEN,
  PAGES_ARTIFACT_ID,
  PAGES_ARTIFACT_NAME,
} = process.env;

if (!/^[1-9]\d*$/.test(PAGES_ARTIFACT_ID ?? '') || !PAGES_ARTIFACT_NAME) {
  throw new Error('The Pages upload did not return an artifact ID and name for this attempt.');
}

const url = new URL(
  `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts`,
);
url.searchParams.set('name', PAGES_ARTIFACT_NAME);
const artifactLabel = `Pages artifact "${PAGES_ARTIFACT_NAME}" (ID ${PAGES_ARTIFACT_ID})`;

// Check immediately and back off only while metadata is unavailable.
for (const backoff of [1, 2, 4, 8, 16, 0]) {
  let response;
  let metadata;
  let reason;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GH_TOKEN}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) metadata = await response.json();
  } catch (error) {
    reason = `artifact API request failed (${error.cause?.code ?? error.name})`;
  }

  if (response?.ok && !reason) {
    const { total_count: count, artifacts } = metadata ?? {};
    if (count > 1)
      throw new Error(`${artifactLabel}: found ${count} artifacts with the same name.`);
    if (!Number.isInteger(count) || !Array.isArray(artifacts) || artifacts.length !== count) {
      throw new Error(`${artifactLabel}: unexpected response from the artifact API.`);
    }
    if (count === 1) {
      const [artifact] = artifacts;
      if (
        String(artifact?.id) !== PAGES_ARTIFACT_ID ||
        artifact.name !== PAGES_ARTIFACT_NAME ||
        (artifact.workflow_run &&
          (String(artifact.workflow_run.id) !== GITHUB_RUN_ID ||
            artifact.workflow_run.head_sha !== GITHUB_SHA))
      ) {
        throw new Error(`${artifactLabel}: metadata does not match the upload or workflow run.`);
      }
      if (artifact.expired !== false) {
        throw new Error(
          `${artifactLabel}: artifact has expired or its expiration status is unknown.`,
        );
      }
      console.log(`Verified ${artifactLabel} for commit ${GITHUB_SHA}.`);
      break;
    }
    reason = 'artifact metadata is not visible yet';
  } else if (!reason) {
    const { status } = response;
    reason = `artifact API returned HTTP ${status}`;
    if (status !== 408 && status !== 429 && status < 500) {
      throw new Error(`${artifactLabel}: ${reason}.`);
    }
  }

  if (!backoff) {
    throw new Error(
      `${artifactLabel}: ${reason} after 6 attempts. Rerun the job to upload a new artifact.`,
    );
  }
  const retryAfter = response?.headers.get('retry-after');
  const requestedDelay =
    retryAfter && (Number(retryAfter) || Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000));
  if (requestedDelay > 16) {
    throw new Error(
      `${artifactLabel}: ${reason}. The API requested a longer wait, so rerun after it recovers.`,
    );
  }
  const delay = Math.max(backoff, requestedDelay || 0);
  console.log(`${artifactLabel}: ${reason}. Retrying in ${delay} seconds.`);
  await wait(delay * 1000);
}
