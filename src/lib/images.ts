import {
  MAX_DIMENSION,
  MAX_FILE_BYTES,
  MAX_PIXELS,
  emptyImageMetadata,
  type LocalImage,
} from '../../shared/model';

export const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export async function loadImage(file: File): Promise<LocalImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error(
      'Choose PNG, JPEG, or WebP images. PNG is recommended for lossless comparisons.',
    );
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: the maximum file size is 20 MB.`);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (
      !width ||
      !height ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION ||
      width * height > MAX_PIXELS
    )
      throw new Error('Images must be at most 36 megapixels and 16,384 pixels per side.');
    return {
      url,
      file,
      name: file.name,
      label: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Screenshot',
      width,
      height,
      size: file.size,
      type: file.type,
      metadata: emptyImageMetadata(),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error && error.message.startsWith('Images must')
      ? error
      : new Error(`${file.name} could not be decoded as a supported image.`);
  }
}
