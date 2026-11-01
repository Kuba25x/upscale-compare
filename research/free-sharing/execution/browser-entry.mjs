import { validateOriginal } from './validate.mjs';
globalThis.validateResearchFile = async ({ spec, identity, token, simulate }) => {
  if (simulate === 'hang') await new Promise(() => {});
  const start = performance.now();
  const response = await fetch(`/jobs/${identity.jobId}/files/${spec.index}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Private original unavailable.');
  const bytes = new Uint8Array(await response.arrayBuffer()),
    fetchWallMs = performance.now() - start;
  const result = await validateOriginal(bytes, spec, identity, async (format) => ({
    wasmBinary: new Uint8Array(await (await fetch(`/codec-${format}.wasm`)).arrayBuffer()),
  }));
  result.metrics.fetchWallMs = fetchWallMs;
  return result;
};
globalThis.researchReady = true;
