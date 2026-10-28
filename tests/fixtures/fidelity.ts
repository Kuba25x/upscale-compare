import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import catalog from './fidelity/manifest.json' with { type: 'json' };
import { pngChunk } from './png';

export const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
export const originals = catalog.files.map((entry) => ({
  ...entry,
  buffer: readFileSync(new URL(`./fidelity/${entry.name}`, import.meta.url)),
}));
export type Original = (typeof originals)[number];
export const original = (name: string) => {
  const entry = originals.find((entry) => entry.name === name);
  if (!entry) throw new Error(`Unknown generated fixture: ${name}`);
  return entry;
};
export const browserFile = (entry: Original) => ({
  name: entry.name,
  mimeType: entry.type,
  buffer: entry.buffer,
});

// Replace only orientation metadata; encoded pixel data remains untouched.
// These valid TIFF IFD0 entries exercise every rotated/mirrored orientation.
export function withOrientation(entry: Original, orientation: number): Buffer<ArrayBuffer> {
  const tiff = Buffer.from('49492a0008000000010012010300010000000100000000000000', 'hex');
  tiff.writeUInt16LE(orientation, 18);
  const data = entry.buffer;
  if (entry.type === 'image/jpeg') {
    let offset = 2;
    while (data[offset] === 0xff && data[offset + 1] !== 0xda) {
      const size = data.readUInt16BE(offset + 2);
      if (
        data[offset + 1] === 0xe1 &&
        data.subarray(offset + 4, offset + 10).equals(Buffer.from('Exif\0\0'))
      ) {
        const replacement = Buffer.concat([
          Buffer.from('ffe10000', 'hex'),
          Buffer.from('Exif\0\0'),
          tiff,
        ]);
        replacement.writeUInt16BE(replacement.length - 2, 2);
        return Buffer.concat([
          data.subarray(0, offset),
          replacement,
          data.subarray(offset + 2 + size),
        ]);
      }
      offset += 2 + size;
    }
  } else if (entry.type === 'image/png') {
    let offset = 8;
    while (offset < data.length) {
      const size = data.readUInt32BE(offset);
      if (data.toString('ascii', offset + 4, offset + 8) === 'eXIf')
        return Buffer.concat([
          data.subarray(0, offset),
          pngChunk('eXIf', tiff),
          data.subarray(offset + size + 12),
        ]);
      offset += size + 12;
    }
  } else if (entry.type === 'image/webp') {
    let offset = 12;
    while (offset < data.length) {
      const size = data.readUInt32LE(offset + 4);
      if (data.toString('ascii', offset, offset + 4) === 'EXIF') {
        const replacement = Buffer.concat([Buffer.from('EXIF'), Buffer.alloc(4), tiff]);
        replacement.writeUInt32LE(tiff.length, 4);
        const result = Buffer.concat([
          data.subarray(0, offset),
          replacement,
          data.subarray(offset + 8 + size + (size % 2)),
        ]);
        result.writeUInt32LE(result.length - 8, 4);
        return result;
      }
      offset += 8 + size + (size % 2);
    }
  }
  throw new Error('The fixture must contain EXIF orientation metadata.');
}
