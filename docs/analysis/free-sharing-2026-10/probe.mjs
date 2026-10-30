// Documentation experiment only. No application imports/configuration are changed.
// Run from the repository root: node --expose-gc docs/analysis/free-sharing-2026-10/probe.mjs
// Requires the existing npm dependencies. Uses no network or Cloudflare credentials.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { crc32 as nativeCrc, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const formatsOnly = process.argv.includes('--formats-only');
if (process.argv.slice(2).some((arg) => arg !== '--formats-only'))
  throw new Error('Unknown argument');

const scratch = resolve('.wrangler/feasibility');
await mkdir(scratch, { recursive: true });
const source = await readFile('worker/src/image-validation.ts', 'utf8');
const crcStart = source.indexOf('export function crc32(');
const crcEnd = source.indexOf('\nfunction dimensions', crcStart);
if (crcStart < 0 || crcEnd < 0) throw new Error('Review the experiment against changed source.');
const variants = {
  original: source,
  indexed:
    source.slice(0, crcStart) +
    'export function crc32(data: Uint8Array): number { let crc = 0xffffffff; for(let i=0;i<data.length;i++) crc=table[(crc^data[i])&255]^(crc>>>8); return (crc^0xffffffff)>>>0; }\n' +
    source.slice(crcEnd),
  native:
    "import {crc32 as nativeCrc} from 'node:zlib';\n" +
    source.slice(0, crcStart) +
    'export function crc32(data: Uint8Array): number { return nativeCrc(data); }\n' +
    source.slice(crcEnd),
};
const modules = {};
for (const [name, contents] of Object.entries(variants)) {
  await build({
    stdin: { contents, loader: 'ts', resolveDir: resolve('worker/src') },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `${scratch}/${name}.mjs`,
  });
  modules[name] = await import(`${scratch}/${name}.mjs`);
}
await build({
  entryPoints: ['worker/src/upload.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: `${scratch}/upload.mjs`,
});
const { readUpload } = await import(`${scratch}/upload.mjs`);
const limits = { maxFileBytes: 20 * 1024 * 1024, maxDimension: 16384, maxPixels: 36000000 };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function chunk(kind, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(kind, 4);
  result.set(data, 8);
  result.writeUInt32BE(nativeCrc(result.subarray(4, -4)), result.length - 4);
  return result;
}
function png(width, height, depth = 8) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(((width * 4 * depth) / 8 + 1) * height))),
    chunk('IEND'),
  ]);
}
const fixtures = formatsOnly
  ? ['4k-noise.jpg', '8k-noise.jpg', '4k-noise.webp', '8k-noise.webp'].map((name) => [
      name,
      () => readFile(`${scratch}/${name}`),
    ])
  : [
      ['4k-grid-rgb8', () => readFile('tests/fixtures/fidelity/uhd.png')],
      ['4k-zero-rgba8', () => png(3840, 2160)],
      ['8k-zero-rgba8', () => png(7680, 4320)],
      ['8k-zero-rgba16', () => png(7680, 4320, 16)],
      [
        '20mib-png-text',
        () => {
          const base = png(32, 24),
            text = Buffer.alloc(limits.maxFileBytes - base.length - 12, 120);
          text.write('Padding\0');
          return Buffer.concat([base.subarray(0, 33), chunk('tEXt', text), base.subarray(33)]);
        },
      ],
      ['jpeg-baseline-small', () => readFile('tests/fixtures/fidelity/baseline.jpg')],
      ['jpeg-progressive-small', () => readFile('tests/fixtures/fidelity/progressive.jpg')],
      ['webp-lossless-small', () => readFile('tests/fixtures/fidelity/lossless-alpha.webp')],
    ];
const samples = [],
  inputs = [];
async function measure(name, variant, fn) {
  await fn(); // one untimed warm-up; fixture allocation is also outside timing
  for (let round = 1; round <= 5; round++) {
    global.gc?.();
    const cpu = process.cpuUsage(),
      start = performance.now();
    await fn();
    const wallMs = performance.now() - start,
      used = process.cpuUsage(cpu);
    samples.push({ name, variant, round, processCpuMs: (used.user + used.system) / 1000, wallMs });
  }
}
const oracle = [];
for (const length of [0, 1, 9, 256, 65536, 1048576]) {
  const bytes = Buffer.alloc(length + 10);
  let seed = 123;
  for (let i = 0; i < bytes.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    bytes[i] = seed >>> 24;
  }
  const view = bytes.subarray(5, 5 + length),
    expected = modules.original.crc32(view);
  for (const [name, mod] of Object.entries(modules)) {
    if (mod.crc32(view) !== expected) throw new Error(`CRC mismatch: ${name}/${length}`);
  }
  if (nativeCrc(view.subarray(length >> 1), nativeCrc(view.subarray(0, length >> 1))) !== expected)
    throw new Error('Incremental CRC mismatch');
  oracle.push({ length, crc32: expected });
}
if (nativeCrc(Buffer.from('123456789')) !== 0xcbf43926) throw new Error('IEEE CRC check failed');
for (const [name, make] of fixtures) {
  const bytes = await make();
  inputs.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  for (const [variant, mod] of Object.entries(
    formatsOnly ? { original: modules.original } : modules,
  )) {
    const info = await mod.validateImage(bytes, limits);
    await measure(name, variant, () => mod.validateImage(bytes, limits));
    console.log(
      JSON.stringify({
        name,
        variant,
        bytes: bytes.length,
        info,
        cpuMs: samples
          .filter((x) => x.name === name && x.variant === variant)
          .map((x) => x.processCpuMs),
      }),
    );
  }
}
if (!formatsOnly) {
  const binary = Buffer.alloc(limits.maxFileBytes, 0x78);
  await measure('sha256-20mib', 'webcrypto', () => crypto.subtle.digest('SHA-256', binary));
  await measure('crc32-20mib', 'original', () => modules.original.crc32(binary));
  await measure('crc32-20mib', 'indexed', () => modules.indexed.crc32(binary));
  await measure('crc32-20mib', 'native', () => nativeCrc(binary));
  const boundary = 'feasibility-fixed-boundary';
  const field = (name, data, filename) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"\r\nContent-Type: image/png` : ''}\r\n\r\n`,
      ),
      data,
      Buffer.from('\r\n'),
    ]);
  const body = Buffer.concat([
    field('manifest', Buffer.from('{}')),
    field('images', binary, 'a.png'),
    field('images', binary, 'b.png'),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  for (const knownLength of [true, false]) {
    await measure(
      'multipart-40mib',
      knownLength ? 'content-length' : 'unknown-length',
      async () => {
        let offset = 0;
        const request = new Request('http://localhost/diagnostic', {
          method: 'POST',
          duplex: 'half',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            ...(knownLength ? { 'Content-Length': String(body.length) } : {}),
          },
          body: new ReadableStream({
            pull(c) {
              if (offset === body.length) return c.close();
              c.enqueue(body.subarray(offset, offset + 65536));
              offset = Math.min(body.length, offset + 65536);
            },
          }),
        });
        const parsed = await readUpload(request, {
          maxFileBytes: limits.maxFileBytes,
          maxTotalBytes: 40 * 1024 * 1024,
        });
        if (
          parsed.images.length !== 2 ||
          parsed.images.some(
            (x) => x.bytes.length !== binary.length || x.bytes[0] !== 120 || x.bytes.at(-1) !== 120,
          )
        )
          throw new Error('Multipart mismatch');
      },
    );
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  auditedCommit: '903c1d50ac7e6caf4b0782af218c184e1e43757f',
  validationSourceSha256: digest(source),
  node: process.version,
  platform: process.platform,
  v8: process.versions.v8,
  zlib: process.versions.zlib,
  scope:
    'Offline Node component process CPU/wall time, five measured rounds after two untimed calls for format validation, one warm-up for isolated hash/CRC/multipart. Not edge CPU, peak isolate memory, whole-request timing, p95/p99 or Free certification. Generated zero/padding cases are adversarial synthetic fixtures, not representative screenshots. The multipart payload tests parsing only, not image validation.',
  productionCodeChanged: false,
  cloudflareFreeCertified: false,
  peakIsolateMemoryBytes: null,
  crcEquivalence: oracle,
  inputs,
  samples,
};
const output = `${scratch}/${formatsOnly ? 'codec-results' : 'results'}.json`;
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Raw results: ${output}`);
