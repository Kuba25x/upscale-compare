export interface ImageLimits {
  maxFileBytes: number;
  maxDimension: number;
  maxPixels: number;
}
export interface ImageInfo {
  width: number;
  height: number;
  type: string;
}
const bad = (message = 'Invalid or unsupported image content.'): never => {
  throw new Error(message);
};
const ascii = (data: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...data.subarray(start, start + length));
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dimensions(width: number, height: number, limits: ImageLimits) {
  if (
    !width ||
    !height ||
    width > limits.maxDimension ||
    height > limits.maxDimension ||
    width * height > limits.maxPixels
  )
    bad('Image dimensions exceed the configured limits.');
}
function checkExif(data: Uint8Array) {
  if (ascii(data, 0, 6) === 'Exif\0\0') data = data.subarray(6);
  if (data.length < 8 || !['II', 'MM'].includes(ascii(data, 0, 2))) bad('Malformed EXIF metadata.');
  const little = data[0] === 0x49;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(2, little) !== 42) bad('Malformed EXIF metadata.');
  const offset = view.getUint32(4, little);
  if (offset + 2 > data.length) bad('Malformed EXIF metadata.');
  const entries = view.getUint16(offset, little);
  if (offset + 2 + entries * 12 > data.length) bad('Malformed EXIF metadata.');
  for (let i = 0; i < entries; i++) {
    const start = offset + 2 + i * 12;
    if (view.getUint16(start, little) !== 0x112) continue;
    if (view.getUint16(start + 2, little) !== 3 || view.getUint32(start + 4, little) !== 1)
      bad('Malformed EXIF orientation.');
    if (view.getUint16(start + 8, little) !== 1)
      bad(
        'Rotated or mirrored EXIF images cannot be published. Export an orientation-normalized screenshot first.',
      );
  }
}
async function png(data: Uint8Array, limits: ImageLimits): Promise<ImageInfo> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8,
    width = 0,
    height = 0,
    rowBytes = 0,
    ended = false,
    idatEnded = false,
    palette = false,
    indexed = false;
  const compressed: Uint8Array[] = [];
  while (offset < data.length) {
    if (offset + 12 > data.length) bad('Truncated PNG chunk.');
    const length = view.getUint32(offset),
      kind = ascii(data, offset + 4, 4),
      start = offset + 8;
    if (length > data.length - offset - 12) bad('Truncated PNG chunk.');
    if (crc32(data.subarray(offset + 4, start + length)) !== view.getUint32(start + length))
      bad('PNG checksum validation failed.');
    if (offset === 8 && (kind !== 'IHDR' || length !== 13)) bad();
    if (kind === 'IHDR') {
      if (offset !== 8 || length !== 13) bad();
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      dimensions(width, height, limits);
      const depth = data[start + 8],
        color = data[start + 9];
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (!depths[color]?.includes(depth) || data[start + 10] || data[start + 11]) bad();
      if (data[start + 12] !== 0)
        bad('Interlaced PNGs are not supported for publishing. Export a non-interlaced PNG.');
      indexed = color === 3;
      rowBytes = Math.ceil((width * { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]! * depth) / 8) + 1;
    } else if (kind === 'PLTE') {
      if (compressed.length || !length || length % 3 || length > 768 || palette) bad();
      palette = true;
    } else if (kind === 'IDAT') {
      if (idatEnded || (indexed && !palette)) bad();
      compressed.push(data.subarray(start, start + length));
    } else if (kind === 'IEND') {
      if (length || !compressed.length || start + 4 !== data.length) bad();
      ended = true;
    } else {
      if (kind === 'eXIf') checkExif(data.subarray(start, start + length));
      if (compressed.length) idatEnded = true;
      if (['acTL', 'fcTL', 'fdAT'].includes(kind))
        bad('Animated images cannot be published. Use a still screenshot.');
      if (kind[0] === kind[0].toUpperCase()) bad('Unknown critical PNG chunk.');
    }
    offset += length + 12;
  }
  if (!ended || !width) bad();
  // Validate the complete compressed raster without allocating a decoded image.
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      for (const chunk of compressed) controller.enqueue(chunk as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = stream.pipeThrough(new DecompressionStream('deflate')).getReader();
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (total + value.length > rowBytes * height)
        bad('PNG decompression exceeds its declared dimensions.');
      let nextFilter = (rowBytes - (total % rowBytes)) % rowBytes;
      for (; nextFilter < value.length; nextFilter += rowBytes)
        if (value[nextFilter] > 4) bad('Invalid PNG scanline filter.');
      total += value.length;
    }
    if (total !== rowBytes * height) bad('Incomplete PNG raster.');
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { width, height, type: 'image/png' };
}
function jpeg(data: Uint8Array, limits: ImageLimits): ImageInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 2,
    width = 0,
    height = 0,
    scan = false,
    ended = false;
  while (offset < data.length) {
    if (data[offset++] !== 0xff) bad('Malformed JPEG marker.');
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xd9) {
      ended = true;
      break;
    }
    if (
      marker === 0xd8 ||
      marker === 0 ||
      marker === undefined ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      bad();
    if (offset + 2 > data.length) bad();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > data.length) bad('Truncated JPEG segment.');
    if (marker === 0xe1 && ascii(data, offset + 2, 6) === 'Exif\0\0')
      checkExif(data.subarray(offset + 2, offset + length));
    if (marker === 0xda) {
      const components = data[offset + 2];
      if (!components || components > 4 || length !== 6 + 2 * components)
        bad('Malformed JPEG scan header.');
    }
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (width || length < 8 || data[offset + 2] !== 8) bad();
      height = view.getUint16(offset + 3);
      width = view.getUint16(offset + 5);
      const components = data[offset + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + components * 3) bad();
      dimensions(width, height, limits);
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      bad('Unsupported JPEG encoding.');
    offset += length;
    if (marker === 0xda) {
      if (!width || length < 6) bad();
      scan = true;
      while (offset < data.length) {
        if (data[offset] !== 0xff) {
          offset++;
          continue;
        }
        if (data[offset + 1] === 0 || (data[offset + 1] >= 0xd0 && data[offset + 1] <= 0xd7)) {
          offset += 2;
          continue;
        }
        break;
      }
    }
  }
  if (!ended || !scan || !width || offset !== data.length) bad('Incomplete JPEG image.');
  return { width, height, type: 'image/jpeg' };
}
function webp(data: Uint8Array, limits: ImageLimits): ImageInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(4, true) + 8 !== data.length) bad('Invalid WebP container size.');
  let offset = 12,
    width = 0,
    height = 0,
    rasterWidth = 0,
    rasterHeight = 0;
  while (offset < data.length) {
    if (offset + 8 > data.length) bad();
    const kind = ascii(data, offset, 4),
      size = view.getUint32(offset + 4, true),
      start = offset + 8;
    if (start + size > data.length) bad();
    if (kind === 'ANIM' || kind === 'ANMF') bad('Animated images cannot be published.');
    if (kind === 'EXIF') checkExif(data.subarray(start, start + size));
    if (kind === 'VP8X') {
      if (offset !== 12 || size !== 10 || data[start] & 2) bad();
      width = 1 + data[start + 4] + (data[start + 5] << 8) + (data[start + 6] << 16);
      height = 1 + data[start + 7] + (data[start + 8] << 8) + (data[start + 9] << 16);
    } else if (kind === 'VP8 ') {
      if (
        rasterWidth ||
        size < 10 ||
        data[start] & 1 ||
        ascii(data, start + 3, 3) !== '\x9d\x01\x2a'
      )
        bad();
      rasterWidth = view.getUint16(start + 6, true) & 0x3fff;
      rasterHeight = view.getUint16(start + 8, true) & 0x3fff;
    } else if (kind === 'VP8L') {
      if (rasterWidth || size < 5 || data[start] !== 0x2f || data[start + 4] >> 5) bad();
      const bits = view.getUint32(start + 1, true);
      rasterWidth = (bits & 0x3fff) + 1;
      rasterHeight = ((bits >>> 14) & 0x3fff) + 1;
    }
    offset = start + size + (size % 2);
  }
  if (
    !rasterWidth ||
    offset !== data.length ||
    (width && (width !== rasterWidth || height !== rasterHeight))
  )
    bad();
  width ||= rasterWidth;
  height ||= rasterHeight;
  dimensions(width, height, limits);
  return { width, height, type: 'image/webp' };
}
export async function validateImage(data: Uint8Array, limits: ImageLimits): Promise<ImageInfo> {
  if (!data.length || data.length > limits.maxFileBytes) bad('Image exceeds the file size limit.');
  if (data.length >= 33 && ascii(data, 0, 8) === '\x89PNG\r\n\x1a\n') return png(data, limits);
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) return jpeg(data, limits);
  if (data.length >= 20 && ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP')
    return webp(data, limits);
  return bad('Only valid PNG, JPEG, and static WebP images are accepted.');
}
