-- Drop legacy session columns from heartbeat_state.
-- These were part of the old warm/cold session model (pre-Cortex).
-- session_state, session_warm_since: warm/cold session tracking (Cortex is always warm)
-- mind_session_id: old AgentManager session UUID
-- conversation_history: old single-session checkpoint (replaced by sessions.db)

ALTER TABLE heartbeat_state DROP COLUMN session_state;
ALTER TABLE heartbeat_state DROP COLUMN session_warm_since;
ALTER TABLE heartbeat_state DROP COLUMN mind_session_id;
ALTER TABLE heartbeat_state DROP COLUMN conversation_history;
