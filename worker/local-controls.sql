-- LOCAL DEVELOPMENT ONLY. These generous test limits are not a production budget.
UPDATE service_control SET publishing_paused = 0, generation = generation + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  max_upload_attempts = 100000, max_upload_bytes = 1099511627776,
  max_publications = 100000, max_publication_bytes = 1099511627776,
  max_read_requests = 100000, max_image_reads = 100000, max_image_bytes = 1099511627776
WHERE id = 1;
