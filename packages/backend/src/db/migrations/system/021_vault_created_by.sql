-- system.db: Add created_by column to vault_entries
-- Tracks whether a vault entry was created by the 'user' (via UI) or 'agent' (via tool).
-- Agent-created entries can be updated/deleted by the agent; user-created entries cannot.

ALTER TABLE vault_entries ADD COLUMN created_by TEXT NOT NULL DEFAULT 'user';
