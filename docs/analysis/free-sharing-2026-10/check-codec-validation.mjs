// Offline diagnostic: demonstrate the difference between structural validation
// and a complete codec decode. No app configuration or stored images are used.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { validateImage } = await import(resolve('.wrangler/feasibility/original.mjs'));
const limits = { maxFileBytes: 20971520, maxDimension: 16384, maxPixels: 36000000 };
// SOF0 + SOS + EOI, with no quantization/Huffman tables or encoded blocks.
const jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f00ffd9', 'hex');
// VP8L signature/dimensions only; no lossless image bitstream.
const webp = Buffer.alloc(26);
webp.write('RIFF');
webp.writeUInt32LE(18, 4);
webp.write('WEBP', 8);
webp.write('VP8L', 12);
webp.writeUInt32LE(5, 16);
webp[20] = 0x2f;
const results = [];
for (const [name, bytes] of [
  ['incomplete-codec.jpg', jpeg],
  ['incomplete-codec.webp', webp],
]) {
  const info = await validateImage(bytes, limits);
  await writeFile(`.wrangler/feasibility/${name}`, bytes);
  results.push({ name, bytes: bytes.length, serverAccepted: true, info });
}
const source = await readFile('worker/src/image-validation.ts', 'utf8');
if (!source.includes('function webp')) throw new Error('Review changed source');
await writeFile(
  '.wrangler/feasibility/codec-validation-results.json',
  JSON.stringify(
    {
      scope: 'Direct offline validator result; not a complete publication or an exploit claim.',
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(results));
