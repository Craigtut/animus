-- Channel Packages — installable channel adapters
CREATE TABLE IF NOT EXISTS channel_packages (
  name TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',
  last_error TEXT
);
