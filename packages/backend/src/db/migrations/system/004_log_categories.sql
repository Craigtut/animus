-- Add log category toggles to system_settings
ALTER TABLE system_settings ADD COLUMN log_categories TEXT NOT NULL DEFAULT '{}';
