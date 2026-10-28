import { deflateSync } from 'node:zlib';
import { crc32 } from '../../worker/src/image-validation';

export const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
export function pngChunk(kind: string, data: Uint8Array = new Uint8Array()) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(kind, 4);
  result.set(data, 8);
  result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4);
  return result;
}
export function rasterPng(width: number, height: number, depth = 8, color = 6) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = color;
  const channels = color === 6 ? 4 : 1;
  const raster = Buffer.alloc((Math.ceil((width * depth * channels) / 8) + 1) * height);
  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raster)),
    pngChunk('IEND'),
  ]);
}
