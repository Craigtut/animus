-- Tool Permissions: user-controlled per-tool permission settings
CREATE TABLE IF NOT EXISTS tool_permissions (
  tool_name TEXT PRIMARY KEY,
  tool_source TEXT NOT NULL,            -- 'core' | 'sdk:claude' | 'sdk:codex' | 'sdk:opencode' | 'plugin:<name>'
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_tier TEXT NOT NULL DEFAULT 'acts', -- 'safe' | 'communicates' | 'acts' | 'sensitive'
  mode TEXT NOT NULL DEFAULT 'ask',      -- 'off' | 'ask' | 'always_allow'
  is_default INTEGER NOT NULL DEFAULT 1, -- 1 if user hasn't customized, 0 if explicitly set
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  trust_ramp_dismissed_at TEXT,          -- null = never dismissed, timestamp = cooldown start
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
