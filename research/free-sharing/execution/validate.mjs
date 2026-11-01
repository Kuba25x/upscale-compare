// Additive research checks; neither production routing nor a publication API.
import { validateImage } from '../../../worker/src/image-validation';
import { createDecoder, completeDecode } from '../codecs.mjs';
export const imageLimits = { maxFileBytes: 20971520, maxDimension: 16384, maxPixels: 36000000 };
export const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export async function validateOriginal(
  bytes,
  spec,
  identity,
  loadDecoderOptions,
  { isolateProfile = false } = {},
) {
  const metrics = {},
    start = performance.now();
  let decoder, image;
  try {
    if (bytes.byteLength !== spec.size) throw new Error('Original length mismatch.');
    let phase = performance.now();
    const sha256 = await digest(bytes);
    metrics.initialHashWallMs = performance.now() - phase;
    if (sha256 !== spec.sha256) throw new Error('Original hash mismatch.');
    phase = performance.now();
    const info = await validateImage(bytes, imageLimits);
    metrics.structureAndPngRasterWallMs = performance.now() - phase;
    if (info.type !== spec.type || info.width !== spec.width || info.height !== spec.height)
      throw new Error('Original type/dimensions mismatch.');
    metrics.encodedBytes = bytes.byteLength;
    if (info.type !== 'image/png') {
      const rgbaBytes = info.width * info.height * 4;
      metrics.twoRgbaCopiesPlusInputBytes = 2 * rgbaBytes + bytes.byteLength;
      if (isolateProfile && metrics.twoRgbaCopiesPlusInputBytes > 96 * 1024 * 1024)
        return {
          state: 'profile-rejected',
          reason:
            'Two required raster copies alone exceed the conservative 96 MiB isolate profile.',
          ...identity,
          index: spec.index,
          metrics,
        };
      const format = info.type === 'image/jpeg' ? 'jpeg' : 'webp';
      phase = performance.now();
      decoder = await createDecoder(format, await loadDecoderOptions(format));
      metrics.codecInitializationWallMs = performance.now() - phase;
      phase = performance.now();
      image = completeDecode(bytes, info, decoder);
      metrics.completeDecodeWallMs = performance.now() - phase;
      if (image.data.buffer === decoder.module.HEAPU8.buffer)
        throw new Error('Review allocation accounting for changed decoder.');
      metrics.wasmLinearMemoryBytes = decoder.module.HEAPU8.buffer.byteLength;
      metrics.jsRgbaOutputBytes = image.data.byteLength;
      metrics.knownRetainedMinimumBytes =
        metrics.encodedBytes + metrics.wasmLinearMemoryBytes + metrics.jsRgbaOutputBytes;
    } else {
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[bytes[25]],
        depth = bytes[24];
      metrics.expandedPngBytes = (Math.ceil((info.width * channels * depth) / 8) + 1) * info.height;
      metrics.knownRetainedMinimumBytes = bytes.byteLength;
      metrics.pngNativeAndQueuePeakBytes = null;
    }
    phase = performance.now();
    const after = await digest(bytes);
    metrics.finalHashWallMs = performance.now() - phase;
    if (after !== sha256) throw new Error('Decoder changed original bytes.');
    metrics.validationWallMs = performance.now() - start;
    if (isolateProfile && metrics.knownRetainedMinimumBytes > 96 * 1024 * 1024)
      return {
        state: 'profile-rejected',
        reason: 'Observed retained lower bound exceeds the conservative 96 MiB isolate profile.',
        ...identity,
        index: spec.index,
        metrics,
      };
    return {
      state: 'validated',
      ...identity,
      index: spec.index,
      sha256,
      size: bytes.byteLength,
      ...info,
      validator: 'existing-structure-plus-jsquash-strict-decode-v1',
      originalUnchanged: true,
      metrics,
    };
  } catch (error) {
    return {
      state: 'rejected',
      ...identity,
      index: spec.index,
      reason: error instanceof Error ? error.message : 'Native codec rejected content.',
      warnings: decoder?.warnings.slice(0, 8).map((s) => s.slice(0, 300)) || [],
      metrics,
    };
  }
}
