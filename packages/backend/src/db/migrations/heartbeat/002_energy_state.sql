ALTER TABLE heartbeat_state ADD COLUMN energy_level REAL NOT NULL DEFAULT 0.85;
ALTER TABLE heartbeat_state ADD COLUMN last_energy_update TEXT;

CREATE TABLE energy_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick_number INTEGER NOT NULL,
  energy_before REAL NOT NULL,
  energy_after REAL NOT NULL,
  delta REAL NOT NULL,
  reasoning TEXT NOT NULL DEFAULT '',
  circadian_baseline REAL NOT NULL,
  energy_band TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_energy_history_created ON energy_history(created_at);
CREATE INDEX idx_energy_history_tick ON energy_history(tick_number);
