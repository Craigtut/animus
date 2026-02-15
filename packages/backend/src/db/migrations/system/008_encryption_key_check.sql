-- Stores an encrypted sentinel value for verifying the encryption key hasn't changed.
-- On startup, the server decrypts this value to confirm the key is correct.
ALTER TABLE system_settings ADD COLUMN encryption_key_check TEXT;
