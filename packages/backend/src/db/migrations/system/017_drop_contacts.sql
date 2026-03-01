-- Drop contacts and contact_channels tables from system.db.
-- These tables have been moved to contacts.db so they can be
-- backed up and restored alongside the AI state databases.

DROP TABLE IF EXISTS contact_channels;
DROP TABLE IF EXISTS contacts;
