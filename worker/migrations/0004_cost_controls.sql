CREATE TABLE service_control (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  publishing_paused INTEGER NOT NULL DEFAULT 1 CHECK(publishing_paused IN (0, 1)),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0 AND generation <= 9007199254740991),
  updated_at TEXT NOT NULL DEFAULT '',
  max_upload_attempts INTEGER NOT NULL DEFAULT 0 CHECK(typeof(max_upload_attempts) = 'integer' AND max_upload_attempts BETWEEN 0 AND 9007199254740991),
  max_upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(max_upload_bytes) = 'integer' AND max_upload_bytes BETWEEN 0 AND 9007199254740991),
  max_publications INTEGER NOT NULL DEFAULT 0 CHECK(typeof(max_publications) = 'integer' AND max_publications BETWEEN 0 AND 9007199254740991),
  max_publication_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(max_publication_bytes) = 'integer' AND max_publication_bytes BETWEEN 0 AND 9007199254740991),
  max_read_requests INTEGER NOT NULL DEFAULT 0 CHECK(typeof(max_read_requests) = 'integer' AND max_read_requests BETWEEN 0 AND 9007199254740991),
  max_image_reads INTEGER NOT NULL DEFAULT 0 CHECK(typeof(max_image_reads) = 'integer' AND max_image_reads BETWEEN 0 AND 9007199254740991),
  max_image_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(max_image_bytes) = 'integer' AND max_image_bytes BETWEEN 0 AND 9007199254740991)
);
INSERT INTO service_control (id) VALUES (1);
CREATE TABLE daily_usage (
  day TEXT PRIMARY KEY,
  upload_attempts INTEGER NOT NULL DEFAULT 0 CHECK(typeof(upload_attempts) = 'integer' AND upload_attempts BETWEEN 0 AND 9007199254740991),
  upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(upload_bytes) = 'integer' AND upload_bytes BETWEEN 0 AND 9007199254740991),
  publications INTEGER NOT NULL DEFAULT 0 CHECK(typeof(publications) = 'integer' AND publications BETWEEN 0 AND 9007199254740991),
  publication_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(publication_bytes) = 'integer' AND publication_bytes BETWEEN 0 AND 9007199254740991),
  read_requests INTEGER NOT NULL DEFAULT 0 CHECK(typeof(read_requests) = 'integer' AND read_requests BETWEEN 0 AND 9007199254740991),
  image_reads INTEGER NOT NULL DEFAULT 0 CHECK(typeof(image_reads) = 'integer' AND image_reads BETWEEN 0 AND 9007199254740991),
  image_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(image_bytes) = 'integer' AND image_bytes BETWEEN 0 AND 9007199254740991)
);
ALTER TABLE comparisons ADD COLUMN publish_generation INTEGER NOT NULL DEFAULT -1;

-- A stop/resume invalidates every earlier admission. Database checks also
-- protect the interval between an application check and reservation/activation.
CREATE TRIGGER comparison_publication_guard BEFORE INSERT ON comparisons
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM service_control WHERE id = 1 AND publishing_paused = 0 AND generation = NEW.publish_generation
  ) THEN RAISE(ABORT, 'Publishing is stopped') END;
END;
CREATE TRIGGER comparison_activation_guard BEFORE UPDATE OF status ON comparisons
WHEN NEW.status = 'active' AND OLD.status != 'active'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM service_control WHERE id = 1 AND publishing_paused = 0 AND generation = NEW.publish_generation
  ) THEN RAISE(ABORT, 'Publishing is stopped') END;
END;
CREATE TRIGGER comparison_charge_daily AFTER INSERT ON comparisons
BEGIN
  INSERT INTO daily_usage (day, publications, publication_bytes)
  SELECT date('now'), 1, NEW.bytes FROM service_control
  WHERE id = 1 AND max_publications >= 1 AND NEW.bytes <= max_publication_bytes
  ON CONFLICT(day) DO UPDATE SET publications = publications + 1, publication_bytes = publication_bytes + NEW.bytes
  WHERE publications < (SELECT max_publications FROM service_control WHERE id = 1)
    AND publication_bytes + NEW.bytes <= (SELECT max_publication_bytes FROM service_control WHERE id = 1);
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'Daily publication budget exhausted') END;
END;
