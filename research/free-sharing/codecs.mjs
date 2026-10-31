// Research decoder candidate. Complete decode is additional validation, never
// conversion/storage output. This wrapper is not a production security audit.
import jpegFactory from '@jsquash/jpeg/codec/dec/mozjpeg_dec.js';
import webpFactory from '@jsquash/webp/codec/dec/webp_dec.js';

export async function createDecoder(format, options) {
  // workerd has no canvas ImageData. Decoder output remains local scratch data.
  if (!globalThis.ImageData)
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  const warnings = [];
  const module = await (format === 'jpeg' ? jpegFactory : webpFactory)({
    ...options,
    printErr: (value) => warnings.push(String(value)),
  });
  return { module, warnings, format };
}
export function completeDecode(bytes, info, decoder) {
  decoder.warnings.length = 0;
  const image =
    decoder.format === 'jpeg' ? decoder.module.decode(bytes, true) : decoder.module.decode(bytes);
  if (
    !image ||
    decoder.warnings.length ||
    image.width !== info.width ||
    image.height !== info.height ||
    image.data.byteLength !== info.width * info.height * 4
  )
    throw new Error('Complete decode rejected content or emitted a warning.');
  return image;
}
