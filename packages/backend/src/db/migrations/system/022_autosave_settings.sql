-- system.db: Add autosave settings to system_settings
-- Controls automatic .animus save-file creation: enabled flag, max count,
-- frequency interval, preferred time of day, and last-run timestamp.

ALTER TABLE system_settings ADD COLUMN autosave_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE system_settings ADD COLUMN autosave_max_count INTEGER NOT NULL DEFAULT 5;
ALTER TABLE system_settings ADD COLUMN autosave_frequency TEXT NOT NULL DEFAULT '24h';
ALTER TABLE system_settings ADD COLUMN autosave_time_of_day INTEGER NOT NULL DEFAULT 3;
ALTER TABLE system_settings ADD COLUMN last_autosave_at TEXT DEFAULT NULL;
