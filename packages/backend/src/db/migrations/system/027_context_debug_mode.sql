-- Enable/disable detailed context snapshot capture per pipeline phase.
-- When enabled, captures full prompt/message content for debugging.
-- When disabled (default), only lightweight token counts are captured.
ALTER TABLE system_settings ADD COLUMN context_debug_mode INTEGER NOT NULL DEFAULT 0;
