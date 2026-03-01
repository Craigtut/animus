-- contacts.db: Initial schema
-- Tables: contacts, contact_channels
-- Moved from system.db to enable backup/restore of contact identity alongside AI state.

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  full_name TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  permission_tier TEXT NOT NULL DEFAULT 'standard',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_is_primary ON contacts(is_primary);

-- Contact channels (identity resolution)
CREATE TABLE IF NOT EXISTS contact_channels (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_name TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_channels_contact ON contact_channels(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_channels_resolve ON contact_channels(channel, identifier);
