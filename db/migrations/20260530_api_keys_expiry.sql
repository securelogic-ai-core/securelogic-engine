-- Add optional expiry support to API keys.
-- NULL means no expiry (the key is permanent until revoked).

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at
  ON api_keys(expires_at)
  WHERE expires_at IS NOT NULL;
