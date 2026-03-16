-- system.db: Budget configuration columns on system_settings singleton

ALTER TABLE system_settings ADD COLUMN budget_weekly_usd REAL DEFAULT 0;
ALTER TABLE system_settings ADD COLUMN budget_start_date TEXT;
ALTER TABLE system_settings ADD COLUMN budget_throttle_enabled INTEGER DEFAULT 1;
ALTER TABLE system_settings ADD COLUMN budget_last_alerted_threshold REAL DEFAULT 0;
