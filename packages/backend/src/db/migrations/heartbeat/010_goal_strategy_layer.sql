-- heartbeat.db: Durable goal strategy layer.
--
-- Plans remain the versioned strategy surface. Milestones move out of the
-- legacy plans.milestones JSON blob into first-class rows. Goal events are the
-- append-only factual history. Goal snapshots are the compact strategic
-- surface shown to the mind. Goal review requests are deterministic cues that
-- ask the mind to apply judgment during a later tick.

ALTER TABLE plans ADD COLUMN reason_created TEXT;
ALTER TABLE plans ADD COLUMN assumptions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE plans ADD COLUMN supersedes_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL;

ALTER TABLE tasks ADD COLUMN milestone_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);

CREATE TABLE IF NOT EXISTS goal_milestones (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  acceptance_criteria TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence TEXT NOT NULL DEFAULT '[]',
  blocker_notes TEXT,
  completion_rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE(plan_id, position)
);
CREATE INDEX IF NOT EXISTS idx_goal_milestones_goal ON goal_milestones(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_milestones_plan ON goal_milestones(plan_id, position);
CREATE INDEX IF NOT EXISTS idx_goal_milestones_status ON goal_milestones(status);

CREATE TABLE IF NOT EXISTS goal_events (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  tick_number INTEGER,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES goal_milestones(id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goal_events_goal ON goal_events(goal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_goal_events_type ON goal_events(type);

CREATE TABLE IF NOT EXISTS goal_snapshots (
  goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  current_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  current_milestone_id TEXT REFERENCES goal_milestones(id) ON DELETE SET NULL,
  recent_progress TEXT NOT NULL DEFAULT '',
  known_blockers TEXT NOT NULL DEFAULT '[]',
  open_questions TEXT NOT NULL DEFAULT '[]',
  next_best_move TEXT NOT NULL DEFAULT '',
  plan_confidence REAL NOT NULL DEFAULT 0.5,
  completion_confidence REAL NOT NULL DEFAULT 0,
  updated_from_event_id TEXT REFERENCES goal_events(id) ON DELETE SET NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goal_snapshots_plan ON goal_snapshots(current_plan_id);
CREATE INDEX IF NOT EXISTS idx_goal_snapshots_milestone ON goal_snapshots(current_milestone_id);

CREATE TABLE IF NOT EXISTS goal_review_requests (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  urgency TEXT NOT NULL DEFAULT 'normal',
  reason TEXT NOT NULL,
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  requested_by TEXT NOT NULL DEFAULT 'system',
  created_tick_number INTEGER,
  resolved_tick_number INTEGER,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_goal_review_requests_goal ON goal_review_requests(goal_id, status, urgency);
CREATE INDEX IF NOT EXISTS idx_goal_review_requests_status ON goal_review_requests(status);

-- Migrate existing JSON milestones into first-class rows. This uses JSON1,
-- available in the SQLite builds we already rely on for JSON extraction.
INSERT OR IGNORE INTO goal_milestones (
  id,
  goal_id,
  plan_id,
  position,
  title,
  description,
  acceptance_criteria,
  status,
  completed_at,
  created_at,
  updated_at
)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  p.goal_id,
  p.id,
  CAST(j.key AS INTEGER),
  COALESCE(json_extract(j.value, '$.title'), 'Untitled milestone'),
  json_extract(j.value, '$.description'),
  json_extract(j.value, '$.acceptanceCriteria'),
  COALESCE(json_extract(j.value, '$.status'), 'pending'),
  json_extract(j.value, '$.completedAt'),
  p.created_at,
  p.created_at
FROM plans p, json_each(p.milestones) AS j
WHERE p.milestones IS NOT NULL
  AND json_valid(p.milestones);

-- Backfill task milestone_id where legacy milestone_index can be resolved.
UPDATE tasks
SET milestone_id = (
  SELECT gm.id
  FROM goal_milestones gm
  WHERE gm.plan_id = tasks.plan_id
    AND gm.position = tasks.milestone_index
  LIMIT 1
)
WHERE milestone_id IS NULL
  AND plan_id IS NOT NULL
  AND milestone_index IS NOT NULL;

-- Create an initial snapshot for each existing goal.
INSERT OR IGNORE INTO goal_snapshots (
  goal_id,
  summary,
  current_plan_id,
  current_milestone_id,
  recent_progress,
  updated_by,
  created_at,
  updated_at
)
SELECT
  g.id,
  COALESCE(g.description, ''),
  (
    SELECT p.id
    FROM plans p
    WHERE p.goal_id = g.id
      AND p.status = 'active'
    ORDER BY p.version DESC
    LIMIT 1
  ),
  (
    SELECT gm.id
    FROM goal_milestones gm
    JOIN plans p ON p.id = gm.plan_id
    WHERE gm.goal_id = g.id
      AND p.status = 'active'
      AND gm.status IN ('in_progress', 'pending')
    ORDER BY
      CASE gm.status WHEN 'in_progress' THEN 0 ELSE 1 END,
      gm.position ASC
    LIMIT 1
  ),
  CASE
    WHEN g.last_progress_at IS NOT NULL THEN 'Recent progress recorded.'
    ELSE ''
  END,
  'system',
  g.created_at,
  g.updated_at
FROM goals g;
