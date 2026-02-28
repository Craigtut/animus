-- Remove the legacy api_keys table. All credentials are now stored in the
-- credentials table (added in 003_credentials.sql) which supports multiple
-- credential types per provider (api_key, oauth_token, cli_detected).
DROP TABLE IF EXISTS api_keys;
