-- Performance indexes for tick event queries (heartbeat inspector)
-- Expression index on JSON_EXTRACT for tick number lookups
CREATE INDEX IF NOT EXISTS idx_agent_events_type_tick ON agent_events(event_type, JSON_EXTRACT(data, '$.tickNumber'));
-- Composite index for timeline lower-bound queries
CREATE INDEX IF NOT EXISTS idx_agent_events_session_type_created ON agent_events(session_id, event_type, created_at);
