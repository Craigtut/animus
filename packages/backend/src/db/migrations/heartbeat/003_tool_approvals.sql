-- Tool Approval Requests: tracks pending/resolved approval requests for gated tools
CREATE TABLE IF NOT EXISTS tool_approval_requests (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  tool_source TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  tick_number INTEGER NOT NULL,

  -- Context preservation
  agent_context TEXT NOT NULL,            -- JSON: task_description, conversation_summary, pending_action, related_goal
  tool_input TEXT,                        -- JSON: the exact parameters passed to the tool
  trigger_summary TEXT NOT NULL,          -- human-readable summary of what triggered this
  conversation_id TEXT,
  originating_agent TEXT NOT NULL,        -- 'mind' or agent_task_id

  -- Resolution
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied' | 'expired'
  scope TEXT,                             -- 'once' (only set on approval)
  batch_id TEXT,                          -- groups requests from same tick for batch approval

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  expires_at TEXT NOT NULL                -- created_at + 24h default
);

CREATE INDEX IF NOT EXISTS idx_tool_approvals_status ON tool_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_tool_approvals_tool ON tool_approval_requests(tool_name, status);
CREATE INDEX IF NOT EXISTS idx_tool_approvals_batch ON tool_approval_requests(batch_id);
