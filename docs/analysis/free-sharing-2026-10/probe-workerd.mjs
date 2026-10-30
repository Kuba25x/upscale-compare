// Documentation experiment: local workerd only; no remote binding or credentials.
// Run after probe.mjs, from the repository root.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
const scratch = resolve('.wrangler/feasibility');
function chunk(kind, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(kind, 4);
  bytes.set(data, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
function png(w, h) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((w * 4 + 1) * h))),
    chunk('IEND'),
  ]);
}
const small = png(32, 24),
  padding = Buffer.alloc(20 * 1024 * 1024 - small.length - 12, 120);
padding.write('Padding\0');
const inputs = [
  ['4k-grid-rgb8', await readFile('tests/fixtures/fidelity/uhd.png')],
  ['8k-zero-rgba8', png(7680, 4320)],
  [
    '20mib-png-text',
    Buffer.concat([small.subarray(0, 33), chunk('tEXt', padding), small.subarray(33)]),
  ],
];
const samples = [],
  checks = [];
for (const variant of ['original', 'native']) {
  const source = (await readFile(`${scratch}/${variant}.mjs`, 'utf8')).replace(
    /export \{[^}]*\};\s*$/,
    '',
  );
  const result = await build({
    stdin: {
      contents:
        source +
        `
    export default { async fetch(request) {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if(new URL(request.url).pathname==='/crc') return Response.json({crc:crc32(bytes)});
      try {return Response.json({info:await validateImage(bytes,{maxFileBytes:20971520,maxDimension:16384,maxPixels:36000000})});}
      catch(error) {return Response.json({error:error.message},{status:400});}
    }};`,
      resolveDir: scratch,
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    external: ['node:zlib'],
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: result.outputFiles[0].text,
      compatibilityDate: '2026-07-01',
      compatibilityFlags: variant === 'native' ? ['nodejs_compat'] : [],
      log: new Log(LogLevel.NONE),
      cf: false,
    }),
  );
  try {
    const check = await mf.dispatchFetch('http://localhost/crc', {
      method: 'POST',
      body: Buffer.from('123456789'),
    });
    const crc = await check.json();
    if (crc.crc !== 0xcbf43926) throw new Error('Runtime CRC mismatch');
    const corrupt = Buffer.from(small);
    corrupt[29] ^= 1;
    const rejected = await mf.dispatchFetch('http://localhost/validate', {
      method: 'POST',
      body: corrupt,
    });
    if (rejected.status !== 400) throw new Error('Runtime accepted corrupt PNG');
    checks.push({ variant, ieeeCrc: crc.crc, rejectCorruptPng: true });
    for (const [name, body] of inputs) {
      for (let round = 0; round <= 3; round++) {
        const start = performance.now(),
          response = await mf.dispatchFetch('http://localhost/validate', { method: 'POST', body });
        const value = await response.json(),
          wallMs = performance.now() - start;
        if (!response.ok || !value.info) throw new Error(JSON.stringify(value));
        if (round)
          samples.push({ name, variant, round, bytes: body.length, hostRoundTripWallMs: wallMs });
      }
    }
  } finally {
    await mf.dispose();
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  miniflare: JSON.parse(await readFile('node_modules/miniflare/package.json', 'utf8')).version,
  workerd: JSON.parse(await readFile('node_modules/workerd/package.json', 'utf8')).version,
  scope:
    'Local Miniflare/workerd host dispatch round-trip wall time including IPC/body transfer. NOT provider CPU or isolate peak memory. No enforced 10 ms admission threshold. Native variant explicitly opts into nodejs_compat only inside this local experiment.',
  cloudflareFreeCertified: false,
  checks,
  samples,
};
await writeFile(`${scratch}/workerd-results.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
