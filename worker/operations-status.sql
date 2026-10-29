-- Read-only aggregate diagnostic. Run only in an approved usage window.
-- Counts may scan tables; this is not a per-request health endpoint.
SELECT publishing_paused, generation, updated_at,
       max_upload_attempts, max_upload_bytes, max_publications,
       max_publication_bytes, max_read_requests, max_image_reads, max_image_bytes
FROM service_control WHERE id = 1;
SELECT day, upload_attempts, upload_bytes, publications, publication_bytes,
       read_requests, image_reads, image_bytes
FROM daily_usage WHERE day = strftime('%Y-%m-%d', 'now');
SELECT q.used_bytes AS reserved_bytes, q.comparisons AS reserved_count,
       COALESCE(SUM(c.bytes), 0) AS retained_row_bytes,
       COUNT(c.id) AS retained_row_count
FROM quota q LEFT JOIN comparisons c ON 1 = 1 WHERE q.id = 1 GROUP BY q.id;
SELECT status, COUNT(*) AS records,
       SUM(CASE WHEN status != 'active' AND cleanup_after <=
           CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
           THEN 1 ELSE 0 END) AS due_records,
       MIN(CASE WHEN status != 'active' THEN cleanup_after END) AS earliest_cleanup_ms
FROM comparisons GROUP BY status;
SELECT COUNT(*) AS expired_rate_rows FROM rate_limits
WHERE expires_at < CAST(strftime('%s', 'now') AS INTEGER);
SELECT COUNT(*) AS expired_retry_rows FROM publication_requests
WHERE expires_at <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER);
