-- system.db: Password vault entries (user-managed credentials for agent use)
-- Stores arbitrary account credentials the user wants their agent to access.
-- Passwords are encrypted with AES-256-GCM via the encryption service.

CREATE TABLE IF NOT EXISTS vault_entries (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  service TEXT NOT NULL,
  url TEXT,
  identity TEXT,
  encrypted_password TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vault_entries_service ON vault_entries(service);
CREATE INDEX IF NOT EXISTS idx_vault_entries_label ON vault_entries(label);
