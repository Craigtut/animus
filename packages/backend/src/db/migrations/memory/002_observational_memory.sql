-- memory.db: Observational memory
-- Tables: observations

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  stream TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  last_raw_id TEXT,
  last_raw_timestamp TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_contact ON observations(contact_id);
CREATE INDEX IF NOT EXISTS idx_observations_stream ON observations(stream);
CREATE INDEX IF NOT EXISTS idx_observations_contact_stream ON observations(contact_id, stream);
