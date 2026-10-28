ALTER TABLE comparisons ADD COLUMN publication_key TEXT;
ALTER TABLE comparisons ADD COLUMN request_hash TEXT;
ALTER TABLE comparisons ADD COLUMN retry_until INTEGER NOT NULL DEFAULT 0;

-- Keep a tombstone after comparison cleanup so retries cannot recreate a
-- deleted or failed publication. Credentials and image bytes are never stored.
CREATE TABLE publication_requests (
  key_hash TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL UNIQUE,
  delete_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX publication_request_expiry ON publication_requests(expires_at);
CREATE TRIGGER comparison_record_publication
AFTER INSERT ON comparisons
WHEN NEW.publication_key IS NOT NULL
BEGIN
  INSERT INTO publication_requests (key_hash, comparison_id, delete_hash, request_hash, expires_at)
  VALUES (NEW.publication_key, NEW.id, NEW.delete_hash, NEW.request_hash, NEW.retry_until);
  -- These columns only carry INSERT values into the transactional trigger.
  -- Retain retry metadata solely in the expiring private table.
  UPDATE comparisons SET publication_key = NULL, request_hash = NULL, retry_until = 0 WHERE id = NEW.id;
END;
