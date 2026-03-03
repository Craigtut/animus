-- Add status and last_error columns to plugins table (mirrors channel_packages pattern).
-- Prevents Docker restarts from permanently deleting installed plugin records.
ALTER TABLE plugins ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE plugins ADD COLUMN last_error TEXT;

-- Mark currently disabled plugins as 'disabled' status
UPDATE plugins SET status = 'disabled' WHERE enabled = 0;
