-- Plugin system support
CREATE TABLE IF NOT EXISTS plugins (
  name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  store_id TEXT,
  config_encrypted TEXT
);
