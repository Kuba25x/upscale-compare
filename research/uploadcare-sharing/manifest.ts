import { z } from 'zod';
import {
  imageMetadataSchema,
  manifestSchema,
  MAX_FILE_BYTES,
  MAX_IMAGES,
  textField,
} from '../../shared/model';
import { APP_URL, LINK_LIMIT, MAX_COMPARISON_BYTES, MIME_TYPES, UUID } from './settings';

const prefix = '#uc-poc/1/';
const digest = /^[0-9a-f]{64}$/;

const fileSchema = z
  .object({
    uuid: z.string().regex(UUID),
    size: z.number().int().min(1).max(MAX_FILE_BYTES),
    type: z.enum(MIME_TYPES),
    sha256: z.string().regex(digest),
    label: textField(120).min(1),
    metadata: imageMetadataSchema,
  })
  .strict();

const fragmentSchema = manifestSchema
  .safeExtend({ images: z.array(fileSchema).min(2).max(MAX_IMAGES) })
  .refine(({ images }) => new Set(images.map(({ uuid }) => uuid)).size === images.length)
  .refine(
    ({ images }) => images.reduce((total, { size }) => total + size, 0) <= MAX_COMPARISON_BYTES,
  );

export type Comparison = z.infer<typeof fragmentSchema>;
export type Original = z.infer<typeof fileSchema>;

const encode = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function comparisonUrl(value: Comparison) {
  const parsed = fragmentSchema.safeParse(value);
  if (!parsed.success) throw new Error('The comparison is invalid or exceeds the image limits.');
  const json = JSON.stringify(parsed.data);
  // Bound encoding work as well as the final URL.
  const encoded = json.length <= LINK_LIMIT ? encode(json) : '';
  const url = APP_URL + prefix + encoded;
  if (!encoded || url.length > LINK_LIMIT) {
    throw new Error('This comparison link is too long. Shorten its description before publishing.');
  }
  return url;
}

export function parseComparison(hash: string): Comparison {
  try {
    if (!hash.startsWith(prefix) || APP_URL.length + hash.length > LINK_LIMIT) throw new Error();
    const encoded = hash.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const bytes = Uint8Array.from(
      atob(encoded.replace(/-/g, '+').replace(/_/g, '/')),
      (character) => character.charCodeAt(0),
    );
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (encode(json) !== encoded) throw new Error();
    return fragmentSchema.parse(JSON.parse(json));
  } catch {
    throw new Error('This comparison link is invalid or uses an unsupported version.');
  }
}
