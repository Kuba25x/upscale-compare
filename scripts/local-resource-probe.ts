import { readFile, writeFile } from 'node:fs/promises';
import { validateImage } from '../worker/src/image-validation';
import { pngChunk, rasterPng } from '../tests/fixtures/png';
import { sha256 } from '../shared/publication';

// Offline component diagnostic only. No network, emulator, provider credentials,
// image re-encoding in the application, or pass/fail threshold based on timing.
const limits = { maxFileBytes: 20 * 1024 * 1024, maxDimension: 16384, maxPixels: 36000000 };
const cases = [
  { name: '4k-generated-grid', make: () => readFile('tests/fixtures/fidelity/uhd.png') },
  { name: '8k-generated-zero-raster', make: async () => rasterPng(7680, 4320) },
  {
    name: '20mib-png-with-text',
    make: async () => {
      const base = rasterPng(32, 24);
      const text = Buffer.alloc(limits.maxFileBytes - base.length - 12, 120);
      text.write('Padding\0');
      return Buffer.concat([base.subarray(0, 33), pngChunk('tEXt', text), base.subarray(33)]);
    },
  },
];
const memory = () => {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, external, arrayBuffers };
};
const samples = [];
for (const item of cases) {
  const bytes = await item.make(); // generated input allocation is outside timing
  for (let round = 1; round <= 3; round++) {
    global.gc?.();
    const before = memory(),
      cpu = process.cpuUsage(),
      start = performance.now();
    const info = await validateImage(bytes, limits);
    const elapsed = performance.now() - start,
      used = process.cpuUsage(cpu);
    const hashCpu = process.cpuUsage(),
      hashStart = performance.now();
    await sha256(bytes);
    const hashElapsed = performance.now() - hashStart,
      hashUsed = process.cpuUsage(hashCpu);
    samples.push({
      name: item.name,
      round,
      bytes: bytes.length,
      ...info,
      validationCpuMs: (used.user + used.system) / 1000,
      validationWallMs: elapsed,
      hashCpuMs: (hashUsed.user + hashUsed.system) / 1000,
      hashWallMs: hashElapsed,
      nodeMemoryBefore: before,
      nodeMemoryAfter: memory(),
    });
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  scope:
    'Offline Node process CPU and before/after process memory; not full HTTP workerd/edge CPU, peak memory or an admission guarantee.',
  cloudflareFreeCertified: false,
  peakIsolateMemoryBytes: null,
  samples,
};
await writeFile(
  '.wrangler/operations/local-resource-report.json',
  JSON.stringify(report, null, 2) + '\n',
);
for (const item of cases) {
  const values = samples.filter((sample) => sample.name === item.name);
  console.log(
    JSON.stringify({
      name: item.name,
      bytes: values[0].bytes,
      validationNodeCpuMs: values.map((value) => value.validationCpuMs),
      hashingNodeCpuMs: values.map((value) => value.hashCpuMs),
    }),
  );
}
console.log(
  'Diagnostic only: .wrangler/operations/local-resource-report.json. Production deployment remains blocked.',
);
