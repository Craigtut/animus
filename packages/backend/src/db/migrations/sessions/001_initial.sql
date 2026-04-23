-- Mind sessions: per-(contact, channel) conversation thread state.
--
-- Each contact+channel pair maintains its own CortexAgent conversation
-- history and observational memory state. Inner-life ticks (timer,
-- scheduled tasks) start with empty history and do not write back.
CREATE TABLE IF NOT EXISTS mind_sessions (
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  conversation_history TEXT,
  cortex_observational_state TEXT,
  context_token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (contact_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_mind_sessions_updated
  ON mind_sessions (updated_at);
