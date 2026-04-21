-- 20260421_users_password_changed_at.sql
--
-- Adds password_changed_at to users so a password change can serve as a
-- soft session-invalidation signal. After a password change, any JWT issued
-- before this timestamp should be considered revoked.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;
