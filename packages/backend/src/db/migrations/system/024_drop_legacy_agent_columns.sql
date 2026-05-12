-- Drop legacy agent SDK settings columns (replaced by cortex_provider, cortex_model, cortex_thinking_level)
ALTER TABLE system_settings DROP COLUMN default_agent_provider;
ALTER TABLE system_settings DROP COLUMN default_model;
ALTER TABLE system_settings DROP COLUMN reasoning_effort;
