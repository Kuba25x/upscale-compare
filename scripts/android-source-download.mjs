import { setTimeout as wait } from 'node:timers/promises';

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const retryableNetworkErrors = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function retryAfterMs(header) {
  if (!header) return 0;
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  return Math.max(0, Date.parse(header) - Date.now()) || 0;
}

export async function readSource(url, readBody, { request = fetch, sleep = wait } = {}) {
  for (const backoff of [1000, 2000, 4000, 0]) {
    let response;
    let failure;
    try {
      response = await request(url, {
        headers: { 'User-Agent': 'Upscale-Compare-source-bundle' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await readBody(response);
    } catch (error) {
      const code = error.cause?.code;
      failure = new Error(`Source download failed (${code ?? error.name}): ${url}`, {
        cause: error,
      });
      if (error.name !== 'TimeoutError' && !retryableNetworkErrors.has(code)) throw failure;
    }

    if (!failure) {
      failure = new Error(`Source download failed (HTTP ${response.status}): ${url}`);
      await response.body?.cancel().catch(() => {});
      if (!retryableStatuses.has(response.status)) throw failure;
    }
    if (!backoff) throw failure;

    const requested = retryAfterMs(response?.headers.get('retry-after'));
    if (requested > 30_000) {
      throw new Error(`${failure.message}. Retry-After exceeds the 30 second wait limit.`, {
        cause: failure,
      });
    }
    const delay = Math.max(backoff, requested);
    console.warn(`${failure.message}. Retrying in ${Math.ceil(delay / 1000)}s.`);
    await sleep(delay);
  }
}
