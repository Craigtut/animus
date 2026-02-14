ALTER TABLE system_settings ADD COLUMN energy_system_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE system_settings ADD COLUMN sleep_start_hour INTEGER NOT NULL DEFAULT 22;
ALTER TABLE system_settings ADD COLUMN sleep_end_hour INTEGER NOT NULL DEFAULT 7;
ALTER TABLE system_settings ADD COLUMN sleep_tick_interval_ms INTEGER NOT NULL DEFAULT 1800000;
