-- Operator fallback when the HTTP control endpoint is unavailable. Does not resume.
UPDATE service_control SET publishing_paused = 1, generation = generation + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1;
