ALTER TABLE comparisons ADD COLUMN cleanup_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comparisons ADD COLUMN cleanup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comparisons ADD COLUMN delete_not_before INTEGER NOT NULL DEFAULT 0;

UPDATE comparisons
SET cleanup_after = COALESCE(CAST(strftime('%s', created_at) AS INTEGER) * 1000, 0) + 3600000
WHERE status = 'pending';

CREATE INDEX comparison_cleanup ON comparisons(cleanup_attempts, cleanup_after, id) WHERE status != 'active';

-- INSERT ... SELECT checks operator limits; this trigger reserves capacity in
-- the same SQLite statement as the pending row. Failure rolls back both.
CREATE TRIGGER comparison_reserve_quota
AFTER INSERT ON comparisons
-- Old Worker versions reserve separately and omit cleanup_after. Retain their
-- accounting until a guarded deployment has drained those requests.
WHEN NEW.cleanup_after > 0
BEGIN
  UPDATE quota SET used_bytes = used_bytes + NEW.bytes, comparisons = comparisons + 1 WHERE id = 1;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'Missing comparison quota ledger') END;
END;
