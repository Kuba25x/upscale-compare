import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
export const fixture = (name) => readFile(resolve(root, 'tests/fixtures', name));
export async function decoderCorpus() {
  const jpg = await fixture('fidelity/baseline.jpg'),
    webp = await fixture('pattern.webp'),
    lossless = await fixture('fidelity/lossless-alpha.webp');
  const sos = jpg.indexOf(Buffer.from([255, 218])),
    start = sos + 2 + jpg.readUInt16BE(sos + 2);
  const entropyCut = Buffer.concat([
    jpg.subarray(0, start + Math.floor((jpg.length - start) / 2)),
    Buffer.from([255, 217]),
  ]);
  const incompleteJpeg = Buffer.from(
    'ffd8ffc0000b080001000101011100ffda0008010100003f00ffd9',
    'hex',
  );
  const incompleteWebp = Buffer.alloc(26);
  incompleteWebp.write('RIFF');
  incompleteWebp.writeUInt32LE(18, 4);
  incompleteWebp.write('WEBP', 8);
  incompleteWebp.write('VP8L', 12);
  incompleteWebp.writeUInt32LE(5, 16);
  incompleteWebp[20] = 0x2f;
  const badHuffman = Buffer.from(jpg),
    dht = jpg.indexOf(Buffer.from([255, 196]));
  if (dht < 0) throw new Error('Fixture lacks Huffman table');
  badHuffman[dht + 5] = 255;
  function cutWebp(bytes) {
    for (let off = 12; off + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(off + 4),
        kind = bytes.toString('ascii', off, off + 4);
      if (kind === 'VP8 ' || kind === 'VP8L') {
        const reduced = Math.max(kind === 'VP8 ' ? 10 : 5, Math.floor(size / 2));
        const result = Buffer.concat([
          bytes.subarray(0, off + 8 + reduced),
          Buffer.alloc(reduced % 2),
        ]);
        result.writeUInt32LE(reduced, off + 4);
        result.writeUInt32LE(result.length - 8, 4);
        return result;
      }
      off += 8 + size + (size % 2);
    }
    throw new Error('No WebP raster');
  }
  return [
    { name: 'jpeg-baseline', format: 'jpeg', bytes: jpg, valid: true },
    {
      name: 'jpeg-progressive',
      format: 'jpeg',
      bytes: await fixture('fidelity/progressive.jpg'),
      valid: true,
    },
    {
      name: 'webp-lossy',
      format: 'webp',
      bytes: await fixture('fidelity/lossy.webp'),
      valid: true,
    },
    { name: 'webp-lossless-alpha', format: 'webp', bytes: lossless, valid: true },
    { name: 'jpeg-missing-tables-blocks', format: 'jpeg', bytes: incompleteJpeg, valid: false },
    { name: 'webp-missing-coded-raster', format: 'webp', bytes: incompleteWebp, valid: false },
    { name: 'jpeg-truncated-entropy-valid-eoi', format: 'jpeg', bytes: entropyCut, valid: false },
    { name: 'jpeg-oversubscribed-huffman-table', format: 'jpeg', bytes: badHuffman, valid: false },
    { name: 'jpeg-missing-eoi', format: 'jpeg', bytes: jpg.subarray(0, -2), valid: false },
    {
      name: 'webp-truncated-vp8-correct-container',
      format: 'webp',
      bytes: cutWebp(webp),
      valid: false,
    },
    {
      name: 'webp-truncated-vp8l-correct-container',
      format: 'webp',
      bytes: cutWebp(lossless),
      valid: false,
    },
    { name: 'webp-truncated-container', format: 'webp', bytes: webp.subarray(0, -3), valid: false },
    {
      name: 'jpeg-rotated-exif',
      format: 'jpeg',
      bytes: await fixture('rotated.jpg'),
      valid: false,
    },
    { name: 'jpeg-valid-after-rejections', format: 'jpeg', bytes: jpg, valid: true },
    { name: 'webp-valid-after-rejections', format: 'webp', bytes: lossless, valid: true },
  ];
}
