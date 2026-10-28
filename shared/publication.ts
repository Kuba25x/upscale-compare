import { manifestSchema, type Manifest } from './model';

export const PUBLICATION_RETRY_MS = 24 * 60 * 60 * 1000;
export const PUBLICATION_CLOCK_SKEW_MS = 5 * 60 * 1000;
export interface PublicationCredentials {
  key: string;
  deleteToken: string;
}
export type PublicationResult =
  { status: 'active'; id: string; shareUrl: string } | { status: 'pending' };
export const randomHex = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
export async function sha256(value: string | Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      ),
    ),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}
export function publicationFingerprint(
  manifest: Manifest,
  images: { type: string; size: number; hash: string }[],
) {
  return sha256(JSON.stringify({ manifest: manifestSchema.parse(manifest), images }));
}
export const publicationHeaders = (credentials: PublicationCredentials) => ({
  'Idempotency-Key': credentials.key,
  Authorization: `Bearer ${credentials.deleteToken}`,
});
