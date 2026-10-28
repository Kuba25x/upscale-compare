import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { PublicComparison } from '../../shared/model';
import type { UploadImage } from './upload';
import { findPublication, type PublicationIntent } from './publication-retry';
import { PublicationError } from './publication-error';
export { PublicationError } from './publication-error';

export interface ComparisonRow {
  id: string;
  payload: string;
  delete_hash: string;
  bytes: number;
  status: 'pending' | 'active' | 'deleting';
  created_at: string;
  cleanup_after: number;
  cleanup_attempts: number;
  delete_not_before: number;
}
export interface Storage {
  DB: D1Database;
  IMAGES: R2Bucket;
}
export const PENDING_LIFETIME_MS = 3600000;
export const CLEANUP_LEASE_MS = 300000;
export const ABANDONED_UPLOAD_GRACE_MS = 3600000;
export const CLEANUP_BATCH_SIZE = 10;
const imageKey = (id: string, index: number) => 'comparisons/' + id + '/' + index;
const imageKeys = (id: string) => [0, 1, 2, 3].map((index) => imageKey(id, index));

async function deferCleanup(storage: Storage, row: ComparisonRow, now: number) {
  const delay = Math.min(3600000, 60000 * 2 ** Math.min(Math.max(row.cleanup_attempts - 1, 0), 6));
  await storage.DB.prepare(
    "UPDATE comparisons SET cleanup_after = ? WHERE id = ? AND delete_hash = ? AND status = 'deleting'",
  )
    .bind(Math.max(now + delay, row.delete_not_before), row.id, row.delete_hash)
    .run();
}

async function finishCleanup(storage: Storage, row: ComparisonRow, now: number) {
  // Derive every possible key from the ID, not from possibly corrupt JSON or
  // the number of acknowledged writes. An R2 put may commit before its error.
  await storage.IMAGES.delete(imageKeys(row.id));
  if (row.delete_not_before > now) {
    await storage.DB.prepare(
      "UPDATE comparisons SET cleanup_after = ? WHERE id = ? AND delete_hash = ? AND status = 'deleting'",
    )
      .bind(row.delete_not_before, row.id, row.delete_hash)
      .run();
    return;
  }
  // The persisted row is the release marker. The transaction releases once
  // even when DELETE, compensation and scheduled cleanup run concurrently.
  const released = await storage.DB.batch([
    storage.DB.prepare(
      "UPDATE quota SET used_bytes = used_bytes - COALESCE((SELECT bytes FROM comparisons WHERE id = ? AND delete_hash = ? AND status = 'deleting'), 0), comparisons = comparisons - (SELECT COUNT(*) FROM comparisons WHERE id = ? AND delete_hash = ? AND status = 'deleting') WHERE id = 1",
    ).bind(row.id, row.delete_hash, row.id, row.delete_hash),
    storage.DB.prepare(
      "DELETE FROM comparisons WHERE id = ? AND delete_hash = ? AND status = 'deleting' AND EXISTS (SELECT 1 FROM quota WHERE id = 1)",
    ).bind(row.id, row.delete_hash),
  ]);
  if (released[0].meta.changes !== 1) throw new Error('Comparison quota ledger is unavailable.');
}

async function cleanupClaimed(storage: Storage, row: ComparisonRow, now: number) {
  try {
    await finishCleanup(storage, row, now);
  } catch (error) {
    // If D1 is unavailable the already-persisted lease still defers the retry.
    await deferCleanup(storage, row, now).catch(() => undefined);
    throw error;
  }
}

export async function eraseComparison(storage: Storage, row: ComparisonRow, now = Date.now()) {
  const claimed = await storage.DB.prepare(
    "UPDATE comparisons SET delete_not_before = CASE WHEN status = 'pending' THEN MAX(cleanup_after, ?) + ? ELSE delete_not_before END, status = 'deleting', cleanup_attempts = cleanup_attempts + 1, cleanup_after = ? WHERE id = ? AND delete_hash = ? RETURNING *",
  )
    .bind(now, ABANDONED_UPLOAD_GRACE_MS, now + CLEANUP_LEASE_MS, row.id, row.delete_hash)
    .first<ComparisonRow>();
  if (claimed) await cleanupClaimed(storage, claimed, now);
}

async function compensatePublication(storage: Storage, id: string, digest: string, now: number) {
  const claimed = await storage.DB.prepare(
    "UPDATE comparisons SET status = 'deleting', cleanup_attempts = cleanup_attempts + 1, cleanup_after = ? WHERE id = ? AND delete_hash = ? AND status = 'pending' RETURNING *",
  )
    .bind(now + CLEANUP_LEASE_MS, id, digest)
    .first<ComparisonRow>();
  if (claimed) return cleanupClaimed(storage, claimed, now);
  const current = await storage.DB.prepare('SELECT * FROM comparisons WHERE id = ?')
    .bind(id)
    .first<ComparisonRow>();
  if (current && current.delete_hash !== digest) return;
  // An activation may have committed before D1 lost its response. Never erase
  // an active comparison because the publication result is ambiguous.
  if (current?.status === 'active') return;
  if (current) return cleanupClaimed(storage, current, now);
  // A late writer can observe that another cleanup has already removed its row.
  await storage.IMAGES.delete(imageKeys(id));
}

export async function saveComparison(
  storage: Storage,
  comparison: PublicComparison,
  digest: string,
  images: UploadImage[],
  limits: { maxStorageBytes: number; maxComparisons: number },
  intent?: PublicationIntent,
) {
  const bytes = images.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  // The trigger and conditional INSERT are one transaction: no reservation can
  // exist without its pending row. Do not compensate an unconfirmed INSERT;
  // a collision belongs to another publisher, and an ambiguous commit is durable.
  const reserved = await storage.DB.prepare(
    "INSERT INTO comparisons (id, payload, delete_hash, bytes, created_at, cleanup_after, publication_key, request_hash, retry_until) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM quota WHERE id = 1 AND used_bytes + ? <= ? AND comparisons < ? AND NOT EXISTS (SELECT 1 FROM publication_requests WHERE key_hash = ?) AND (? = 0 OR ? > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) RETURNING id",
  )
    .bind(
      comparison.id,
      JSON.stringify(comparison),
      digest,
      bytes,
      comparison.createdAt,
      Date.now() + PENDING_LIFETIME_MS,
      intent?.keyHash ?? null,
      intent?.requestHash ?? null,
      intent?.expiresAt ?? 0,
      bytes,
      limits.maxStorageBytes,
      limits.maxComparisons,
      intent?.keyHash ?? null,
      intent?.expiresAt ?? 0,
      intent?.expiresAt ?? 0,
    )
    .first();
  if (!reserved && intent) {
    if (intent.expiresAt <= Date.now())
      throw new PublicationError(410, 'The 24-hour publication recovery window has expired.');
    const existing = await findPublication(storage.DB, intent);
    if (existing) return existing;
  }
  if (!reserved)
    throw new PublicationError(
      507,
      'The sharing service has reached its storage limit. Please contact the site operator.',
    );
  try {
    for (let i = 0; i < images.length; i++) {
      const pending = await storage.DB.prepare(
        "SELECT id FROM comparisons WHERE id = ? AND delete_hash = ? AND status = 'pending' AND cleanup_after > ?",
      )
        .bind(comparison.id, digest, Date.now())
        .first();
      if (!pending) throw new Error('Publication is no longer pending.');
      await storage.IMAGES.put(imageKey(comparison.id, i), images[i].bytes, {
        httpMetadata: { contentType: comparison.images[i].type },
        customMetadata: { comparison: comparison.id },
      });
    }
    const active = await storage.DB.prepare(
      "UPDATE comparisons SET status = 'active' WHERE id = ? AND delete_hash = ? AND status = 'pending' AND cleanup_after > ? RETURNING id",
    )
      .bind(comparison.id, digest, Date.now())
      .first();
    if (!active) throw new Error('Publication could not activate.');
    return { status: 'active' as const, id: comparison.id };
  } catch {
    await compensatePublication(storage, comparison.id, digest, Date.now()).catch(() => undefined);
    throw new PublicationError(503, 'Publishing could not finish. Please try again later.');
  }
}

export async function sweepComparisons(storage: Storage, now = Date.now()) {
  let failures = 0,
    completed = 0;
  try {
    await storage.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?')
      .bind(Math.floor(now / 1000))
      .run();
  } catch {
    failures++;
  }
  try {
    // Bounded maintenance; timestamp validation also rejects an expired key
    // after its tombstone is gone. Never recreate a publication on a late retry.
    await storage.DB.prepare(
      'DELETE FROM publication_requests WHERE key_hash IN (SELECT key_hash FROM publication_requests WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)',
    )
      .bind(now)
      .run();
  } catch {
    failures++;
  }
  const due = await storage.DB.prepare(
    "SELECT * FROM comparisons WHERE status != 'active' AND cleanup_after <= ? AND (status != 'pending' OR cleanup_after > 0 OR created_at < ?) ORDER BY cleanup_attempts, cleanup_after, id LIMIT ?",
  )
    .bind(now, new Date(now - PENDING_LIFETIME_MS).toISOString(), CLEANUP_BATCH_SIZE)
    .all<ComparisonRow>();
  for (const candidate of due.results) {
    try {
      // Recheck at claim time: a pending candidate may have activated since SELECT.
      const claimed = await storage.DB.prepare(
        "UPDATE comparisons SET delete_not_before = CASE WHEN status = 'pending' THEN ? ELSE delete_not_before END, status = 'deleting', cleanup_attempts = cleanup_attempts + 1, cleanup_after = ? WHERE id = ? AND delete_hash = ? AND status != 'active' AND cleanup_after <= ? RETURNING *",
      )
        .bind(
          now + ABANDONED_UPLOAD_GRACE_MS,
          now + CLEANUP_LEASE_MS,
          candidate.id,
          candidate.delete_hash,
          now,
        )
        .first<ComparisonRow>();
      if (claimed) {
        await cleanupClaimed(storage, claimed, now);
        completed++;
      }
    } catch {
      failures++;
    }
  }
  // Process independent rows before reporting a failed run. No raw storage
  // errors, manifests or deletion credentials are included in the message.
  if (failures)
    throw new Error('Comparison maintenance encountered ' + failures + ' failed operation(s).');
  return { processed: completed };
}
