-- heartbeat.db: Add conversation_history column for cortex session persistence
-- The conversation_history column stores serialized JSON of the cortex agent's
-- message history, enabling crash recovery and session persistence across restarts.
-- The existing session_state and session_warm_since columns are deprecated but
-- retained for backward compatibility during the cortex migration.

ALTER TABLE heartbeat_state ADD COLUMN conversation_history TEXT;
