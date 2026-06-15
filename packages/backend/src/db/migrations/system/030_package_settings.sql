-- Ongoing package settings, separate from setup configuration.

CREATE TABLE IF NOT EXISTS package_settings (
  package_type TEXT NOT NULL CHECK (package_type IN ('plugin', 'channel')),
  package_name TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_type, package_name, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_package_settings_package
  ON package_settings(package_type, package_name);
