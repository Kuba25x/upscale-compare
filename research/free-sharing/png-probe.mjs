// Offline actual-validator diagnostic; keeps original byte/decompression checks.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scratch } from './harness.mjs';
const root = resolve(import.meta.dirname, '../..');
await mkdir(scratch, { recursive: true });
await build({
  stdin: {
    contents: `export {validateImage} from './worker/src/image-validation'; export {rasterPng} from './tests/fixtures/png';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(scratch, 'png-components.mjs'),
});
const { validateImage, rasterPng } = await import(resolve(scratch, 'png-components.mjs'));
const limits = { maxFileBytes: 20971520, maxDimension: 16384, maxPixels: 36000000 },
  samples = [];
for (const [name, make] of [
  ['4k-rgb-grid', () => readFile(resolve(root, 'tests/fixtures/fidelity/uhd.png'))],
  ['8k-rgba8-zero', () => rasterPng(7680, 4320)],
  ['8k-rgba16-zero', () => rasterPng(7680, 4320, 16)],
]) {
  const bytes = await make();
  await validateImage(bytes, limits);
  for (let round = 1; round <= 3; round++) {
    global.gc?.();
    const cpu = process.cpuUsage(),
      start = performance.now(),
      info = await validateImage(bytes, limits);
    const wallMs = performance.now() - start,
      used = process.cpuUsage(cpu);
    samples.push({
      name,
      round,
      bytes: bytes.length,
      ...info,
      processCpuMs: (used.user + used.system) / 1000,
      wallMs,
    });
  }
}
await writeFile(
  resolve(scratch, 'png-resources.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      node: process.version,
      scope:
        'Node process CPU of unchanged full PNG validator, 3 rounds after warm-up; no peak isolate memory, edge CPU or Free certification.',
      cloudflareFreeCertified: false,
      samples,
    },
    null,
    2,
  ) + '\n',
);
