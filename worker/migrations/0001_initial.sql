CREATE TABLE IF NOT EXISTS comparisons (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  delete_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'deleting'))
);
CREATE TABLE IF NOT EXISTS quota (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
  comparisons INTEGER NOT NULL DEFAULT 0 CHECK(comparisons >= 0)
);
INSERT OR IGNORE INTO quota (id) VALUES (1);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at);
