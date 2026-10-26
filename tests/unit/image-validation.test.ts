import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { crc32, validateImage } from '../../worker/src/image-validation';
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
