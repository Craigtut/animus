-- heartbeat.db: Task-scoped work journals.
-- Journals preserve continuity for task work across heartbeat ticks.

CREATE TABLE IF NOT EXISTS task_journals (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started',
  handoff TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  learned TEXT NOT NULL DEFAULT '[]',
  decisions TEXT NOT NULL DEFAULT '[]',
  artifacts TEXT NOT NULL DEFAULT '[]',
  open_questions TEXT NOT NULL DEFAULT '[]',
  next_steps TEXT NOT NULL DEFAULT '[]',
  token_count INTEGER NOT NULL DEFAULT 0,
  updated_tick_number INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO task_journals (task_id, created_at, updated_at)
  SELECT
    id,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM tasks;

ALTER TABLE agent_tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent_task ON agent_tasks(parent_task_id);
