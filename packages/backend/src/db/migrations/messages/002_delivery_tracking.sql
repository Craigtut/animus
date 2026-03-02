-- Delivery tracking for outbound messages.
-- Adds status, external provider ID, error details, and mind notification flag.

ALTER TABLE messages ADD COLUMN delivery_status TEXT;
ALTER TABLE messages ADD COLUMN external_id TEXT;
ALTER TABLE messages ADD COLUMN delivery_error TEXT;
ALTER TABLE messages ADD COLUMN mind_notified INTEGER;

-- Backfill existing outbound messages as 'sent'
UPDATE messages SET delivery_status = 'sent' WHERE direction = 'outbound';

-- Partial index for querying unnotified failures (used by gather-context)
CREATE INDEX IF NOT EXISTS idx_messages_unnotified_failures
  ON messages(delivery_status, mind_notified)
  WHERE delivery_status = 'failed' AND (mind_notified IS NULL OR mind_notified = 0);
