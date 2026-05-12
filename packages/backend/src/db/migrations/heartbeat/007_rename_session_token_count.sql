-- Rename session_token_count to context_token_count to align with Cortex terminology.
-- "context tokens" refers to the current context window footprint, not a session lifetime metric.
ALTER TABLE heartbeat_state RENAME COLUMN session_token_count TO context_token_count;
