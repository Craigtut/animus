-- system.db: Add cortex provider/model settings columns
-- These columns store the cortex-specific provider and model configuration,
-- separate from the existing defaultAgentProvider/defaultModel which remain
-- for the legacy agents package during migration.

ALTER TABLE system_settings ADD COLUMN cortex_provider TEXT;
ALTER TABLE system_settings ADD COLUMN cortex_model TEXT;
ALTER TABLE system_settings ADD COLUMN cortex_thinking_level TEXT DEFAULT 'off';
ALTER TABLE system_settings ADD COLUMN utility_model TEXT DEFAULT 'default';
