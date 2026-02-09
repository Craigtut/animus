-- heartbeat.db: Initial schema
-- Tables: heartbeat_state, emotion_state, emotion_history, thoughts, experiences,
--         tick_decisions, goal_seeds, goals, plans, goal_salience_log,
--         tasks, task_runs, agent_tasks

-- Heartbeat state (singleton)
CREATE TABLE IF NOT EXISTS heartbeat_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tick_number INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT 'idle',
  session_state TEXT NOT NULL DEFAULT 'cold',
  trigger_type TEXT,
  trigger_context TEXT,
  mind_session_id TEXT,
  session_token_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_tick_at TEXT,
  session_warm_since TEXT,
  is_running INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO heartbeat_state (id) VALUES (1);

-- Emotion state (12 fixed rows, updated in place)
CREATE TABLE IF NOT EXISTS emotion_state (
  emotion TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  intensity REAL NOT NULL DEFAULT 0,
  baseline REAL NOT NULL DEFAULT 0,
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO emotion_state (emotion, category) VALUES
  ('joy', 'positive'),
  ('contentment', 'positive'),
  ('excitement', 'positive'),
  ('gratitude', 'positive'),
  ('confidence', 'positive'),
  ('stress', 'negative'),
  ('anxiety', 'negative'),
  ('frustration', 'negative'),
  ('sadness', 'negative'),
  ('boredom', 'negative'),
  ('curiosity', 'drive'),
  ('loneliness', 'drive');

-- Emotion history (append-only log)
CREATE TABLE IF NOT EXISTS emotion_history (
  id TEXT PRIMARY KEY,
  tick_number INTEGER NOT NULL,
  emotion TEXT NOT NULL,
  delta REAL NOT NULL,
  reasoning TEXT NOT NULL,
  intensity_before REAL NOT NULL,
  intensity_after REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emotion_history_tick ON emotion_history(tick_number);
CREATE INDEX IF NOT EXISTS idx_emotion_history_emotion ON emotion_history(emotion);
CREATE INDEX IF NOT EXISTS idx_emotion_history_created ON emotion_history(created_at);

-- Thoughts
CREATE TABLE IF NOT EXISTS thoughts (
  id TEXT PRIMARY KEY,
  tick_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_thoughts_tick ON thoughts(tick_number);
CREATE INDEX IF NOT EXISTS idx_thoughts_expires ON thoughts(expires_at);
CREATE INDEX IF NOT EXISTS idx_thoughts_importance ON thoughts(importance);

-- Experiences
CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  tick_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_experiences_tick ON experiences(tick_number);
CREATE INDEX IF NOT EXISTS idx_experiences_expires ON experiences(expires_at);
CREATE INDEX IF NOT EXISTS idx_experiences_importance ON experiences(importance);

-- Tick decisions
CREATE TABLE IF NOT EXISTS tick_decisions (
  id TEXT PRIMARY KEY,
  tick_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters TEXT,
  outcome TEXT NOT NULL,
  outcome_detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tick_decisions_tick ON tick_decisions(tick_number);
CREATE INDEX IF NOT EXISTS idx_tick_decisions_type ON tick_decisions(type);

-- Goal seeds
CREATE TABLE IF NOT EXISTS goal_seeds (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  motivation TEXT,
  strength REAL NOT NULL DEFAULT 0.5,
  linked_emotion TEXT,
  source TEXT NOT NULL DEFAULT 'internal',
  reinforcement_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  graduated_to_goal_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reinforced_at TEXT NOT NULL DEFAULT (datetime('now')),
  decayed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_goal_seeds_status ON goal_seeds(status);

-- Goals
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  motivation TEXT,
  origin TEXT NOT NULL,
  seed_id TEXT REFERENCES goal_seeds(id) ON DELETE SET NULL,
  linked_emotion TEXT,
  created_by_contact_id TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  base_priority REAL NOT NULL DEFAULT 0.5,
  current_salience REAL NOT NULL DEFAULT 0.5,
  completion_criteria TEXT,
  deadline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT,
  completed_at TEXT,
  abandoned_at TEXT,
  abandoned_reason TEXT,
  last_progress_at TEXT,
  last_user_mention_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_salience ON goals(current_salience);

-- Plans
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  strategy TEXT NOT NULL,
  milestones TEXT,
  created_by TEXT NOT NULL DEFAULT 'mind',
  revision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_plans_goal ON plans(goal_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);

-- Goal salience log
CREATE TABLE IF NOT EXISTS goal_salience_log (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  salience REAL NOT NULL,
  base_priority REAL NOT NULL,
  emotional_resonance REAL NOT NULL,
  user_engagement REAL NOT NULL,
  progress_momentum REAL NOT NULL,
  urgency REAL NOT NULL,
  staleness_penalty REAL NOT NULL,
  novelty REAL NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_salience_log_goal ON goal_salience_log(goal_id);

-- Tasks (full model)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'one_shot',
  cron_expression TEXT,
  scheduled_at TEXT,
  next_run_at TEXT,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  milestone_index INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  priority REAL NOT NULL DEFAULT 0.5,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  result TEXT,
  created_by TEXT NOT NULL DEFAULT 'mind',
  contact_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_schedule ON tasks(schedule_type);
CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run_at);
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);

-- Task runs (recurring task execution log)
CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  agent_task_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id);

-- Agent tasks (sub-agent tracking)
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  tick_number INTEGER NOT NULL,
  session_id TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'spawning',
  task_type TEXT NOT NULL,
  task_description TEXT NOT NULL,
  contact_id TEXT,
  source_channel TEXT,
  current_activity TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  timeout_at TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_tick ON agent_tasks(tick_number);
