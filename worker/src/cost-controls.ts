import type { D1Database } from '@cloudflare/workers-types';
import { PublicationError } from './publication-error';

export interface Control {
  publishing_paused: number;
  generation: number;
  updated_at: string;
  max_upload_attempts: number;
  max_upload_bytes: number;
  max_publications: number;
  max_publication_bytes: number;
  max_read_requests: number;
  max_image_reads: number;
  max_image_bytes: number;
}
const unavailable = () =>
  new PublicationError(
    503,
    'The sharing service has reached its daily limit or is temporarily paused. Please try again later.',
  );
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export async function readControl(db: D1Database) {
  const control = await db.prepare('SELECT * FROM service_control WHERE id = 1').first<Control>();
  if (!control) throw unavailable();
  return control;
}
export async function requirePublishing(db: D1Database) {
  const control = await readControl(db);
  if (
    control.publishing_paused ||
    control.max_upload_attempts < 1 ||
    control.max_upload_bytes < 1 ||
    control.max_publications < 1 ||
    control.max_publication_bytes < 1
  )
    throw unavailable();
  return control.generation;
}
export async function publishingAvailable(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT c.publishing_paused,
    c.max_upload_attempts > COALESCE(u.upload_attempts, 0) AND c.max_upload_bytes > COALESCE(u.upload_bytes, 0)
    AND c.max_publications > COALESCE(u.publications, 0) AND c.max_publication_bytes > COALESCE(u.publication_bytes, 0) AS capacity
    FROM service_control c LEFT JOIN daily_usage u ON u.day = ? WHERE c.id = 1`,
    )
    .bind(utcDay())
    .first<{ publishing_paused: number; capacity: number }>();
  if (!row) throw unavailable();
  return row.publishing_paused === 0 && row.capacity === 1;
}
export async function admitUpload(db: D1Database, bytes: number, now = Date.now()) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw unavailable();
  const result = await db
    .prepare(
      `INSERT INTO daily_usage (day, upload_attempts, upload_bytes)
    SELECT ?, 1, ? FROM service_control WHERE id = 1 AND publishing_paused = 0 AND max_upload_attempts >= 1 AND max_upload_bytes > 0 AND ? <= max_upload_bytes AND max_publications > 0 AND max_publication_bytes > 0
    ON CONFLICT(day) DO UPDATE SET upload_attempts = upload_attempts + 1, upload_bytes = upload_bytes + excluded.upload_bytes
    WHERE upload_attempts < (SELECT max_upload_attempts FROM service_control WHERE id = 1)
      AND upload_bytes + excluded.upload_bytes <= (SELECT max_upload_bytes FROM service_control WHERE id = 1)
      AND publications < (SELECT max_publications FROM service_control WHERE id = 1)
      AND publication_bytes < (SELECT max_publication_bytes FROM service_control WHERE id = 1)
    RETURNING (SELECT generation FROM service_control WHERE id = 1) AS generation`,
    )
    .bind(utcDay(now), bytes, bytes)
    .first<{ generation: number }>();
  if (!result) throw unavailable();
  return result.generation;
}
export async function assertPublishingGeneration(db: D1Database, generation: number) {
  const allowed = await db
    .prepare(
      'SELECT id FROM service_control WHERE id = 1 AND publishing_paused = 0 AND generation = ?',
    )
    .bind(generation)
    .first();
  if (!allowed) throw unavailable();
}
export async function admitRead(db: D1Database, now = Date.now()) {
  const admitted = await db
    .prepare(
      `INSERT INTO daily_usage (day, read_requests)
    SELECT ?, 1 FROM service_control WHERE id = 1 AND max_read_requests >= 1
    ON CONFLICT(day) DO UPDATE SET read_requests = read_requests + 1
    WHERE read_requests < (SELECT max_read_requests FROM service_control WHERE id = 1) RETURNING day`,
    )
    .bind(utcDay(now))
    .first();
  if (!admitted) throw unavailable();
}
export async function admitImage(db: D1Database, bytes: number, now = Date.now()) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw unavailable();
  const admitted = await db
    .prepare(
      `INSERT INTO daily_usage (day, image_reads, image_bytes)
    SELECT ?, 1, ? FROM service_control WHERE id = 1 AND max_image_reads >= 1 AND ? <= max_image_bytes
    ON CONFLICT(day) DO UPDATE SET image_reads = image_reads + 1, image_bytes = image_bytes + excluded.image_bytes
    WHERE image_reads < (SELECT max_image_reads FROM service_control WHERE id = 1)
      AND image_bytes + excluded.image_bytes <= (SELECT max_image_bytes FROM service_control WHERE id = 1) RETURNING day`,
    )
    .bind(utcDay(now), bytes, bytes)
    .first();
  if (!admitted) throw unavailable();
}
export async function stopPublishing(db: D1Database) {
  const stopped = await db
    .prepare(
      "UPDATE service_control SET publishing_paused = 1, generation = generation + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 RETURNING generation",
    )
    .first<{ generation: number }>();
  if (!stopped) throw unavailable();
  return { publishingPaused: true, generation: stopped.generation };
}
