import { describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import {
  crc32,
  MAX_IMAGE_CHUNKS,
  PNG_INPUT_BYTES,
  validateImage,
} from '../../worker/src/image-validation';
import { pngChunk, rasterPng } from '../fixtures/png';
const limits = { maxFileBytes: 20 * 1024 * 1024, maxDimension: 16384, maxPixels: 36000000 };
export function makePng(width = 32, height = 24) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}
describe('server image validation', () => {
  it('validates a complete PNG raster and dimensions', async () => {
    expect(await validateImage(makePng(), limits)).toEqual({
      width: 32,
      height: 24,
      type: 'image/png',
    });
  });
  it.each(['<svg onload="alert(1)"></svg>', '<html>not an image</html>', 'GIF89a', ''])(
    'rejects non-image content: %s',
    async (content) => {
      await expect(validateImage(new TextEncoder().encode(content), limits)).rejects.toThrow();
    },
  );
  it('rejects corrupt CRCs', async () => {
    const data = makePng();
    data[29] ^= 1;
    await expect(validateImage(data, limits)).rejects.toThrow('checksum');
  });
  it('rejects a truncated PNG', async () => {
    await expect(validateImage(makePng().subarray(0, 60), limits)).rejects.toThrow();
  });
  it('rejects data appended after IEND', async () => {
    await expect(
      validateImage(Buffer.concat([makePng(), Buffer.from('payload')]), limits),
    ).rejects.toThrow();
  });
  it('rejects excessive pixels', async () => {
    await expect(validateImage(makePng(), { ...limits, maxPixels: 10 })).rejects.toThrow(
      'dimensions',
    );
  });
  it('rejects excessive dimensions', async () => {
    await expect(validateImage(makePng(), { ...limits, maxDimension: 16 })).rejects.toThrow(
      'dimensions',
    );
  });
  it('rejects oversized files', async () => {
    await expect(validateImage(makePng(), { ...limits, maxFileBytes: 10 })).rejects.toThrow('size');
  });
  it('rejects decompression beyond declared dimensions', async () => {
    const data = makePng();
    data.writeUInt32BE(1, 20);
    data.writeUInt32BE(crc32(data.subarray(12, 29)), 29);
    await expect(validateImage(data, limits)).rejects.toThrow('dimensions');
  });
  it('rejects JPEG signatures without image data', async () => {
    await expect(validateImage(Uint8Array.of(255, 216, 255, 217), limits)).rejects.toThrow();
  });
  it('rejects invalid WebP containers', async () => {
    const data = Buffer.alloc(30);
    data.write('RIFF');
    data.writeUInt32LE(22, 4);
    data.write('WEBP', 8);
    await expect(validateImage(data, limits)).rejects.toThrow();
  });
});

describe('additional image formats', () => {
  it.each([
    ['pattern.jpg', 'image/jpeg'],
    ['pattern.webp', 'image/webp'],
  ])('validates an actual %s file', async (name, type) => {
    const { readFile } = await import('node:fs/promises');
    expect(await validateImage(await readFile(`tests/fixtures/${name}`), limits)).toEqual({
      width: 64,
      height: 48,
      type,
    });
  });
  it('rejects embedded rotation that would change source-coordinate interpretation', async () => {
    const { readFile } = await import('node:fs/promises');
    await expect(
      validateImage(await readFile('tests/fixtures/rotated.jpg'), limits),
    ).rejects.toThrow('orientation-normalized');
  });
});

describe('image validation resource bounds', () => {
  it('rejects the small-file, many-empty-IDAT regression before starting decompression', async () => {
    const data = makePng();
    const attack = Buffer.concat([
      data.subarray(0, 33),
      ...Array(100000).fill(pngChunk('IDAT')),
      data.subarray(33),
    ]);
    const decompression = vi.spyOn(globalThis, 'DecompressionStream');
    try {
      await expect(validateImage(attack, limits)).rejects.toThrow('too many chunks');
      expect(decompression).not.toHaveBeenCalled();
    } finally {
      decompression.mockRestore();
    }
  });
  it('accepts the PNG chunk ceiling, including legal empty IDATs', async () => {
    const data = makePng();
    const result = Buffer.concat([
      data.subarray(0, 33),
      ...Array(MAX_IMAGE_CHUNKS - 3).fill(pngChunk('IDAT')),
      data.subarray(33),
    ]);
    expect(await validateImage(result, limits)).toEqual({
      width: 32,
      height: 24,
      type: 'image/png',
    });
  });
  it('also bounds ancillary PNG chunks', async () => {
    const data = makePng();
    await expect(
      validateImage(
        Buffer.concat([
          data.subarray(0, 33),
          ...Array(MAX_IMAGE_CHUNKS).fill(pngChunk('tEXt')),
          data.subarray(33),
        ]),
        limits,
      ),
    ).rejects.toThrow('too many chunks');
  });
  it('validates an 8K screenshot raster without allocating a decoded image', async () => {
    expect(await validateImage(rasterPng(7680, 4320), limits)).toEqual({
      width: 7680,
      height: 4320,
      type: 'image/png',
    });
  });
  it('feeds large IDATs to decompression in bounded pieces', async () => {
    const image = new PNG({ width: 256, height: 256 });
    let seed = 123;
    for (let i = 0; i < image.data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      image.data[i] = seed >>> 24;
    }
    const data = PNG.sync.write(image, { deflateChunkSize: 1024 * 1024 });
    const NativeDecompression = globalThis.DecompressionStream;
    const sizes: number[] = [];
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readable: ReadableStream;
        writable: WritableStream;
        constructor(format: CompressionFormat) {
          const stream = new NativeDecompression(format);
          const writer = stream.writable.getWriter();
          this.readable = stream.readable;
          this.writable = new WritableStream({
            write(chunk: Uint8Array<ArrayBuffer>) {
              sizes.push(chunk.byteLength);
              return writer.write(chunk);
            },
            close: () => writer.close(),
            abort: (reason) => writer.abort(reason),
          });
        }
      },
    );
    try {
      expect(data.length).toBeGreaterThan(PNG_INPUT_BYTES * 2);
      await expect(validateImage(data, limits)).resolves.toMatchObject({ width: 256 });
      expect(Math.max(...sizes)).toBeLessThanOrEqual(PNG_INPUT_BYTES);
      expect(sizes.every((size) => size > 0)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('bounds JPEG segment counts independently of dimensions', async () => {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile('tests/fixtures/pattern.jpg');
    await expect(
      validateImage(
        Buffer.concat([
          data.subarray(0, 2),
          ...Array(MAX_IMAGE_CHUNKS).fill(Buffer.from([255, 254, 0, 2])),
          data.subarray(2),
        ]),
        limits,
      ),
    ).rejects.toThrow('too many chunks or segments');
  });
  it('bounds WebP chunk counts independently of dimensions', async () => {
    const { readFile } = await import('node:fs/promises');
    const data = await readFile('tests/fixtures/pattern.webp');
    const extra = Buffer.alloc(8);
    extra.write('JUNK');
    const result = Buffer.concat([data, ...Array(MAX_IMAGE_CHUNKS).fill(extra)]);
    result.writeUInt32LE(result.length - 8, 4);
    await expect(validateImage(result, limits)).rejects.toThrow('too many chunks or segments');
  });
});
