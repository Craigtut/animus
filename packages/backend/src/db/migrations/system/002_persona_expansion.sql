-- system.db: Persona expansion & onboarding state
-- Expands personality_settings with full persona fields per docs/architecture/persona.md
-- Adds onboarding state tracking to system_settings

-- Expand personality_settings with full persona fields
ALTER TABLE personality_settings ADD COLUMN existence_paradigm TEXT NOT NULL DEFAULT 'digital_consciousness';
ALTER TABLE personality_settings ADD COLUMN location TEXT;
ALTER TABLE personality_settings ADD COLUMN world_description TEXT;
ALTER TABLE personality_settings ADD COLUMN gender TEXT;
ALTER TABLE personality_settings ADD COLUMN age INTEGER;
ALTER TABLE personality_settings ADD COLUMN physical_description TEXT;
ALTER TABLE personality_settings ADD COLUMN personality_dimensions TEXT NOT NULL DEFAULT '{}';
ALTER TABLE personality_settings ADD COLUMN background TEXT;
ALTER TABLE personality_settings ADD COLUMN personality_notes TEXT;
ALTER TABLE personality_settings ADD COLUMN archetype TEXT;
ALTER TABLE personality_settings ADD COLUMN is_finalized INTEGER NOT NULL DEFAULT 0;

-- Add onboarding state to system_settings
ALTER TABLE system_settings ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE system_settings ADD COLUMN onboarding_complete INTEGER NOT NULL DEFAULT 0;
