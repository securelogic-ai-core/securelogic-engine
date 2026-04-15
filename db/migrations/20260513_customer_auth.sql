-- Migration: customer_auth
-- Package: customer-auth
-- Depends on: 001_securelogic_platform (organizations, users tables)
--
-- Extends the existing users table with email/password authentication columns.
-- The users table already exists from 001_securelogic_platform; we add only
-- the missing columns using ADD COLUMN IF NOT EXISTS so this is safe to re-run.
--
-- Also adds promo_code column to organizations for Stripe promotional pricing.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. promo_code on organizations
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS promo_code TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Auth columns on existing users table
-- ─────────────────────────────────────────────────────────────────────────────

-- Display name (default empty string for existing rows; app sets it on creation)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';

-- Bcrypt hash; default empty string keeps NOT NULL constraint safe for legacy rows
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';

-- Email verification
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_token TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

-- Password reset
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Global unique email constraint
--    001_securelogic_platform has UNIQUE (organization_id, email); we now want
--    a global unique across all orgs.  Drop the old constraint first if present.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_organization_id_email_key;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_email_unique;

ALTER TABLE users
  ADD CONSTRAINT users_email_unique UNIQUE (email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS users_email_verification_token_idx
  ON users (email_verification_token)
  WHERE email_verification_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_password_reset_token_idx
  ON users (password_reset_token)
  WHERE password_reset_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_organization_id_idx
  ON users (organization_id);
