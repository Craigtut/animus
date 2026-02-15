-- persona.db: Initial schema
-- Personality settings moved from system.db to its own database

CREATE TABLE IF NOT EXISTS personality_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Animus',
  traits TEXT NOT NULL DEFAULT '[]',
  communication_style TEXT NOT NULL DEFAULT 'helpful and thoughtful',
  "values" TEXT NOT NULL DEFAULT '[]',
  existence_paradigm TEXT NOT NULL DEFAULT 'digital_consciousness',
  location TEXT,
  world_description TEXT,
  gender TEXT,
  age INTEGER,
  physical_description TEXT,
  personality_dimensions TEXT NOT NULL DEFAULT '{}',
  background TEXT,
  personality_notes TEXT,
  archetype TEXT,
  is_finalized INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO personality_settings (id) VALUES (1);
