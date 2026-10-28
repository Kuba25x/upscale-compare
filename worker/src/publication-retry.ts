import type { D1Database } from '@cloudflare/workers-types';
import { PUBLICATION_CLOCK_SKEW_MS, PUBLICATION_RETRY_MS, sha256 } from '../../shared/publication';
import { PublicationError } from './publication-error';

export interface PublicationIntent {
  keyHash: string;
  digest: string;
  expiresAt: number;
  requestHash?: string;
}
export async function readPublicationCredentials(
  request: Request,
  now = Date.now(),
): Promise<PublicationIntent> {
  const key = request.headers.get('Idempotency-Key') || '';
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!/^\d{13}\.[a-f0-9]{64}$/.test(key) || !token)
    throw new PublicationError(
      400,
      'A valid publication identifier and private deletion key are required.',
    );
  const createdAt = Number(key.slice(0, 13));
  if (createdAt > now + PUBLICATION_CLOCK_SKEW_MS)
    throw new PublicationError(
      400,
      'The publication timestamp is in the future. Check your device clock.',
    );
  const expiresAt = createdAt + PUBLICATION_RETRY_MS;
  if (expiresAt <= now)
    throw new PublicationError(410, 'The 24-hour publication recovery window has expired.');
  return { keyHash: await sha256(key), digest: await sha256(token), expiresAt };
}
export async function findPublication(db: D1Database, intent: PublicationIntent) {
  const row = await db
    .prepare(
      'SELECT p.comparison_id, p.delete_hash, p.request_hash, c.status, c.cleanup_after FROM publication_requests p LEFT JOIN comparisons c ON c.id = p.comparison_id AND c.delete_hash = p.delete_hash WHERE p.key_hash = ?',
    )
    .bind(intent.keyHash)
    .first<{
      comparison_id: string;
      delete_hash: string;
      request_hash: string;
      status: string | null;
      cleanup_after: number | null;
    }>();
  if (!row) return null;
  // Both digests have fixed length. Do not expose whether another publisher's
  // identifier exists to a caller without its private capability.
  let difference = intent.digest.length ^ row.delete_hash.length;
  for (let i = 0; i < intent.digest.length; i++)
    difference |= intent.digest.charCodeAt(i) ^ row.delete_hash.charCodeAt(i);
  if (difference)
    throw new PublicationError(404, 'No publication was found for these credentials.');
  if (intent.requestHash && row.request_hash !== intent.requestHash)
    throw new PublicationError(
      409,
      'This publication identifier belongs to different images or settings.',
    );
  if (row.status === 'active') return { status: 'active' as const, id: row.comparison_id };
  if (row.status === 'pending' && row.cleanup_after! > Date.now())
    return { status: 'pending' as const };
  throw new PublicationError(
    410,
    'This publication did not complete or has been deleted. It cannot be retried with the same identifier.',
  );
}
