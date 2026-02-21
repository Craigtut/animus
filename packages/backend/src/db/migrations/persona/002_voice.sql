-- persona.db: Add voice selection to personality
ALTER TABLE personality_settings ADD COLUMN voice_id TEXT;
ALTER TABLE personality_settings ADD COLUMN voice_speed REAL DEFAULT 1.0;
