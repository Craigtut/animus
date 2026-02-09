-- system.db: Initial schema
-- Tables: users, contacts, contact_channels, channel_configs, system_settings, personality_settings, api_keys

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  contact_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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

-- Add FK from users to contacts (after contacts table exists)
-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we rely on the contact_id column
-- being populated correctly at the application level.

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

-- Channel configurations
CREATE TABLE IF NOT EXISTS channel_configs (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL DEFAULT '{}',
  is_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- System settings (singleton)
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 300000,
  session_warmth_ms INTEGER NOT NULL DEFAULT 900000,
  session_context_budget REAL NOT NULL DEFAULT 0.7,
  thought_retention_days INTEGER NOT NULL DEFAULT 30,
  experience_retention_days INTEGER NOT NULL DEFAULT 30,
  emotion_history_retention_days INTEGER NOT NULL DEFAULT 30,
  agent_log_retention_days INTEGER NOT NULL DEFAULT 14,
  default_agent_provider TEXT NOT NULL DEFAULT 'claude',
  goal_approval_mode TEXT NOT NULL DEFAULT 'always_approve',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO system_settings (id) VALUES (1);

-- Personality settings (singleton)
CREATE TABLE IF NOT EXISTS personality_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Animus',
  traits TEXT NOT NULL DEFAULT '[]',
  communication_style TEXT NOT NULL DEFAULT 'helpful and thoughtful',
  "values" TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO personality_settings (id) VALUES (1);

-- API keys (encrypted storage)
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
