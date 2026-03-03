-- agent_logs.db: Credential access audit log
-- Tracks every credential access for security auditing.

CREATE TABLE IF NOT EXISTS credential_access_log (
  id TEXT PRIMARY KEY,
  credential_type TEXT NOT NULL,  -- 'vault' | 'plugin' | 'channel'
  credential_ref TEXT NOT NULL,   -- e.g. 'vault:uuid' or 'pluginName.configKey'
  tool_name TEXT NOT NULL,        -- tool that triggered access (e.g. 'run_with_credentials')
  agent_context TEXT,             -- 'mind' | 'sub-agent:<taskId>' | 'channel:<channelType>'
  accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credential_access_log_ref ON credential_access_log(credential_ref);
CREATE INDEX IF NOT EXISTS idx_credential_access_log_accessed ON credential_access_log(accessed_at);
CREATE INDEX IF NOT EXISTS idx_credential_access_log_type ON credential_access_log(credential_type);
