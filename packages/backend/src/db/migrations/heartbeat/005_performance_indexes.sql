-- Performance indexes for heartbeat inspector queries
CREATE INDEX IF NOT EXISTS idx_thoughts_created ON thoughts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiences_created ON experiences(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tick_decisions_created ON tick_decisions(created_at DESC);
