import type { LocalImage, Manifest } from '../../shared/model';
import {
  PUBLICATION_RETRY_MS,
  publicationFingerprint,
  randomHex,
  sha256,
  type PublicationCredentials,
} from '../../shared/publication';
import { API_URL } from './api';
import { requireSharing } from './config';

export interface PublicationAttempt extends PublicationCredentials {
  fingerprint: string;
  createdAt: number;
}
const prefix = () => `upscale-compare:publication:${API_URL}:`;
export const JOURNAL_CHANGED = 'upscale-compare:publications-changed';
export function pendingPublications(): PublicationAttempt[] {
  try {
    const results: PublicationAttempt[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(prefix())) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key)!);
        if (
          key === prefix() + value.key &&
          /^\d{13}\.[a-f0-9]{64}$/.test(value.key) &&
          /^[a-f0-9]{64}$/.test(value.deleteToken) &&
          /^[a-f0-9]{64}$/.test(value.fingerprint) &&
          value.createdAt === Number(value.key.slice(0, 13))
        )
          results.push(value);
      } catch {
        /* Ignore corrupt entries without discarding other private keys. */
      }
    }
    return results.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}
export async function preparePublication(
  images: LocalImage[],
  manifest: Manifest,
  forceNew = false,
): Promise<PublicationAttempt> {
  requireSharing();
  const digests = [];
  // Read/hash one original at a time; never retain another set of all image bytes.
  for (const image of images) {
    if (!image.file) throw new Error('Only local comparisons can be published.');
    digests.push({
      type: image.file.type,
      size: image.file.size,
      hash: await sha256(new Uint8Array(await image.file.arrayBuffer())),
    });
  }
  const fingerprint = await publicationFingerprint(manifest, digests);
  const pending = pendingPublications();
  const existing =
    !forceNew &&
    pending.find(
      (attempt) =>
        attempt.fingerprint === fingerprint &&
        attempt.createdAt + PUBLICATION_RETRY_MS > Date.now(),
    );
  const createdAt = Date.now();
  const attempt = existing || {
    fingerprint,
    createdAt,
    key: `${createdAt}.${randomHex(32)}`,
    deleteToken: randomHex(32),
  };
  try {
    if (!existing && pending.length >= 20) throw new Error('Full journal');
    const key = prefix() + attempt.key;
    const serialized = JSON.stringify(attempt);
    localStorage.setItem(key, serialized);
    if (localStorage.getItem(key) !== serialized) throw new Error('Storage verification failed');
  } catch {
    throw new Error(
      'Your browser could not save the private publication key. Enable browser storage, or resolve pending publications, before publishing.',
    );
  }
  window.dispatchEvent(new Event(JOURNAL_CHANGED));
  return attempt;
}
export function completePublication(attempt: PublicationAttempt, id: string) {
  // Retain the journal if saving the normal per-comparison key fails.
  localStorage.setItem(`upscale-compare:delete:${API_URL}:${id}`, attempt.deleteToken);
  if (localStorage.getItem(`upscale-compare:delete:${API_URL}:${id}`) !== attempt.deleteToken)
    throw new Error('Deletion key could not be saved');
  forgetPublication(attempt);
}
export function forgetPublication(attempt: PublicationAttempt) {
  localStorage.removeItem(prefix() + attempt.key);
  window.dispatchEvent(new Event(JOURNAL_CHANGED));
}
