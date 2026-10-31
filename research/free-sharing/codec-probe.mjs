// Run locally with --expose-gc. No network, personal data or app configuration.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createDecoder, completeDecode } from './codecs.mjs';
import { scratch } from './harness.mjs';
const root = resolve(import.meta.dirname, '../..');
await mkdir(scratch, { recursive: true });
await build({
  entryPoints: [resolve(root, 'worker/src/image-validation.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: resolve(scratch, 'validator.mjs'),
});
const { validateImage } = await import(resolve(scratch, 'validator.mjs'));
const limits = { maxFileBytes: 20971520, maxDimension: 16384, maxPixels: 36000000 };
const catalog = JSON.parse(await readFile(resolve(scratch, 'codec-inputs/catalog.json'), 'utf8'));
const samples = [];
for (const input of catalog.fixtures) {
  global.gc?.();
  const bytes = await readFile(resolve(scratch, 'codec-inputs', input.name));
  if (createHash('sha256').update(bytes).digest('hex') !== input.sha256)
    throw new Error('Fixture changed');
  const info = await validateImage(bytes, limits),
    format = info.type === 'image/jpeg' ? 'jpeg' : 'webp';
  const wasmName = format === 'jpeg' ? 'mozjpeg_dec' : 'webp_dec';
  const wasm = await readFile(
    resolve(import.meta.dirname, `node_modules/@jsquash/${format}/codec/dec/${wasmName}.wasm`),
  );
  const initStart = performance.now(),
    decoder = await createDecoder(format, { wasmBinary: wasm });
  const initializationWallMs = performance.now() - initStart;
  for (let round = 0; round <= 3; round++) {
    global.gc?.();
    const cpu = process.cpuUsage(),
      start = performance.now();
    const image = completeDecode(bytes, info, decoder),
      wallMs = performance.now() - start,
      used = process.cpuUsage(cpu);
    if (createHash('sha256').update(bytes).digest('hex') !== input.sha256)
      throw new Error('Decoder changed original bytes');
    const heapBytes = decoder.module.HEAPU8.buffer.byteLength,
      outputBytes = image.data.byteLength;
    // Distinct retained linear memory, JS output copy, and original source.
    if (image.data.buffer === decoder.module.HEAPU8.buffer)
      throw new Error('Review zero-copy accounting');
    if (round)
      samples.push({
        name: input.name,
        format,
        round,
        bytes: bytes.length,
        width: info.width,
        height: info.height,
        processCpuMs: (used.user + used.system) / 1000,
        wallMs,
        initializationWallMs,
        wasmLinearMemoryBytes: heapBytes,
        jsOutputBytes: outputBytes,
        minimumRetainedBytes: heapBytes + outputBytes + bytes.length,
        originalSha256: input.sha256,
      });
  }
  console.log(
    input.name,
    JSON.stringify(
      samples
        .filter((x) => x.name === input.name)
        .map((x) => ({
          cpu: x.processCpuMs,
          minimumRetainedMiB: x.minimumRetainedBytes / 1048576,
        })),
    ),
  );
}
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  v8: process.versions.v8,
  scope:
    'Node process CPU of full WASM decode only, 3 measured rounds after warm-up, excluding structural checks, upload/storage/hash and cold init. Lower-bound retained allocation is not peak isolate memory. No provider CPU or Free-plan evidence.',
  packages: { jpeg: '@jsquash/jpeg@1.6.0', webp: '@jsquash/webp@1.5.0' },
  cloudflareFreeCertified: false,
  samples,
};
await writeFile(resolve(scratch, 'codec-resources.json'), JSON.stringify(report, null, 2) + '\n');
