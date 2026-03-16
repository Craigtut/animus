-- agent_logs.db: Enrich usage records with tick context, add daily rollup table

-- Enrich usage records with tick context
ALTER TABLE agent_usage ADD COLUMN tick_number INTEGER;
ALTER TABLE agent_usage ADD COLUMN tick_type TEXT;
ALTER TABLE agent_usage ADD COLUMN pipeline_phase TEXT;
ALTER TABLE agent_usage ADD COLUMN contact_id TEXT;
ALTER TABLE agent_usage ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;
ALTER TABLE agent_usage ADD COLUMN cache_write_tokens INTEGER DEFAULT 0;

-- Index for tick_type + created_at breakdown queries
-- (idx_agent_usage_created already exists from 001_initial)
CREATE INDEX IF NOT EXISTS idx_agent_usage_tick_type ON agent_usage(tick_type, created_at);

-- Daily rollup table for long-term retention (raw data pruned after 30 days)
CREATE TABLE IF NOT EXISTS usage_daily_rollups (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  tick_type TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  tick_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_rollups_date ON usage_daily_rollups(date);
CREATE INDEX IF NOT EXISTS idx_usage_rollups_date_type ON usage_daily_rollups(date, tick_type);
