-- memory.db: Initial schema
-- Tables: working_memory, core_self, long_term_memories

-- Working memory (per-contact notepad)
CREATE TABLE IF NOT EXISTS working_memory (
  contact_id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Core self (singleton — agent's self-knowledge)
CREATE TABLE IF NOT EXISTS core_self (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL DEFAULT '',
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO core_self (id) VALUES (1);

-- Long-term memories (extracted knowledge metadata — vectors live in LanceDB)
CREATE TABLE IF NOT EXISTS long_term_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  memory_type TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  contact_id TEXT,
  keywords TEXT NOT NULL DEFAULT '[]',
  strength INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ltm_type ON long_term_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_ltm_contact ON long_term_memories(contact_id);
CREATE INDEX IF NOT EXISTS idx_ltm_importance ON long_term_memories(importance);
CREATE INDEX IF NOT EXISTS idx_ltm_last_accessed ON long_term_memories(last_accessed_at);
