-- Package Distribution: columns for .anpk install, verification, and rollback

-- Plugins table: distribution columns
ALTER TABLE plugins ADD COLUMN package_version TEXT;
ALTER TABLE plugins ADD COLUMN package_checksum TEXT;
ALTER TABLE plugins ADD COLUMN signature_status TEXT DEFAULT 'unsigned';
ALTER TABLE plugins ADD COLUMN installed_from TEXT DEFAULT 'local';
ALTER TABLE plugins ADD COLUMN package_cache_path TEXT;
ALTER TABLE plugins ADD COLUMN previous_version TEXT;
ALTER TABLE plugins ADD COLUMN permissions_granted TEXT;

-- Channel packages table: distribution columns
ALTER TABLE channel_packages ADD COLUMN package_version TEXT;
ALTER TABLE channel_packages ADD COLUMN package_checksum TEXT;
ALTER TABLE channel_packages ADD COLUMN signature_status TEXT DEFAULT 'unsigned';
ALTER TABLE channel_packages ADD COLUMN installed_from TEXT DEFAULT 'local';
ALTER TABLE channel_packages ADD COLUMN package_cache_path TEXT;
ALTER TABLE channel_packages ADD COLUMN previous_version TEXT;
ALTER TABLE channel_packages ADD COLUMN permissions_granted TEXT;
