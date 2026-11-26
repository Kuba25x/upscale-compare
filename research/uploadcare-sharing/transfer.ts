import {
  MAX_DIMENSION,
  MAX_FILE_BYTES,
  MAX_IMAGES,
  MAX_PIXELS,
  type Config,
  type LocalImage,
  type Metadata,
} from '../../shared/model';
import { loadImage } from '../../src/lib/images';
import { validateImage } from '../../worker/src/image-validation';
import { comparisonUrl, parseComparison, type Comparison, type Original } from './manifest';
import {
  MAX_COMPARISON_BYTES,
  MIME_TYPES,
  MOCK_PUBLIC_KEY,
  PROVIDER_ORIGIN,
  UUID,
} from './settings';

const validationLimits = {
  maxFileBytes: MAX_FILE_BYTES,
  maxDimension: MAX_DIMENSION,
  maxPixels: MAX_PIXELS,
};

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function releaseImages(images: LocalImage[]) {
  images.forEach(({ url }) => URL.revokeObjectURL(url));
}

async function provider(path: string, options: RequestInit, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(PROVIDER_ORIGIN + path, {
      ...options,
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    });
  } catch {
    signal.throwIfAborted();
    throw new Error('The mock provider is unavailable. Check the loopback server and try again.');
  }
  if (response.ok) return response;
  await response.body?.cancel().catch(() => undefined);
  switch (response.status) {
    case 401:
    case 403:
      throw new Error('The mock upload permit was refused or expired. Start a new publication.');
    case 404:
    case 410:
      throw new Error(
        'An original is unavailable. It may have expired or the mock server restarted.',
      );
    case 413:
      throw new Error('The mock provider rejected the upload size.');
    case 429:
      throw new Error('The mock provider reached its usage limit. Try again later.');
    default:
      throw new Error('The mock provider could not complete the request. Try again.');
  }
}

async function readOriginal(original: Original, signal: AbortSignal) {
  const response = await provider(`/${original.uuid}/`, {}, signal);
  if (response.headers.get('content-type')?.split(';', 1)[0] !== original.type || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The mock provider returned an unexpected image type.');
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(original.size);
  let offset = 0;
  try {
    for (;;) {
      const next = await reader.read().catch(() => {
        signal.throwIfAborted();
        throw new Error('The original download was interrupted. Try opening the link again.');
      });
      if (next.done) break;
      if (next.value.length > bytes.length - offset) {
        throw new Error('The downloaded original exceeds its declared size.');
      }
      bytes.set(next.value, offset);
      offset += next.value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (offset !== bytes.length || (await sha256(bytes)) !== original.sha256) {
    throw new Error('The downloaded original does not match its SHA-256 or size.');
  }
  signal.throwIfAborted();
  return bytes;
}

export async function publish(
  images: LocalImage[],
  metadata: Metadata,
  config: Config,
  signal: AbortSignal,
) {
  if (
    images.length < 2 ||
    images.length > MAX_IMAGES ||
    images.some(({ file }) => !file || file.size === 0 || file.size > MAX_FILE_BYTES) ||
    images.reduce((total, { file }) => total + (file?.size ?? 0), 0) > MAX_COMPARISON_BYTES
  ) {
    throw new Error('Select two to four fixtures within the comparison size limits.');
  }

  const comparison: Comparison = { metadata, config, images: [] };
  for (const { file, label, metadata: imageMetadata } of images) {
    signal.throwIfAborted();
    const source = file!;
    const bytes = new Uint8Array(await source.arrayBuffer());
    const info = await validateImage(bytes, validationLimits);
    const type = MIME_TYPES.find((mime) => mime === info.type && mime === source.type);
    if (!type) throw new Error('Choose a valid PNG, JPEG, or static WebP fixture.');
    comparison.images.push({
      uuid: crypto.randomUUID(), // Reserve equal-length placeholders for the URL check.
      size: source.size,
      type,
      sha256: await sha256(bytes),
      label,
      metadata: imageMetadata,
    });
  }
  comparisonUrl(comparison);

  const permitResponse = await provider(
    '/permit/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: images.length }),
    },
    signal,
  );
  const { token } = await permitResponse.json();
  if (typeof token !== 'string' || !UUID.test(token))
    throw new Error('The mock permit is invalid.');

  try {
    for (const [index, original] of comparison.images.entries()) {
      const form = new FormData();
      form.set('UPLOADCARE_PUB_KEY', MOCK_PUBLIC_KEY);
      form.set('UPLOADCARE_STORE', '0');
      form.set('file', images[index].file!);
      const upload = await provider(
        '/base/',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        },
        signal,
      );
      const { file: uuid } = await upload.json();
      if (typeof uuid !== 'string' || !UUID.test(uuid)) {
        throw new Error('The mock provider returned an invalid file identifier.');
      }
      original.uuid = uuid;
    }
    const url = comparisonUrl(comparison);
    for (const original of comparison.images) await readOriginal(original, signal);
    return { url, originals: comparison.images };
  } catch (error) {
    signal.throwIfAborted();
    const message = error instanceof Error ? error.message : 'Publication failed.';
    throw new Error(`${message} Any temporary uploads expire automatically.`);
  }
}

export async function openComparison(hash: string, signal: AbortSignal) {
  const comparison = parseComparison(hash);
  const images: LocalImage[] = [];
  try {
    for (const original of comparison.images) {
      const bytes = await readOriginal(original, signal);
      const { type, width, height } = await validateImage(bytes, validationLimits);
      if (type !== original.type) throw new Error('The comparison contains an invalid image.');
      const image = await loadImage(new File([bytes], original.uuid, { type }));
      images.push({
        ...image,
        file: undefined,
        label: original.label,
        metadata: original.metadata,
      });
      if (image.width !== width || image.height !== height) {
        throw new Error('The decoded image dimensions do not match the original.');
      }
      signal.throwIfAborted();
    }
    return { images, metadata: comparison.metadata, config: comparison.config };
  } catch (error) {
    releaseImages(images);
    throw error;
  }
}
