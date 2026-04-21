-- MFA (TOTP) columns for customer users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret      text,
  ADD COLUMN IF NOT EXISTS totp_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_backup_codes text[]  NOT NULL DEFAULT '{}';
