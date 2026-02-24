-- heartbeat.db: Add planning prompt fields to goals table
--
-- These fields support urgency escalation for goals without plans:
-- - activated_at_tick: The tick number when the goal became active
-- - plan_prompt_urgency: Cached urgency level ('soft', 'stronger', 'forceful')

-- Add activated_at_tick column (tick number when goal became active)
ALTER TABLE goals ADD COLUMN activated_at_tick INTEGER;

-- Add plan_prompt_urgency column (cached urgency level for planning prompts)
ALTER TABLE goals ADD COLUMN plan_prompt_urgency TEXT DEFAULT 'soft';
