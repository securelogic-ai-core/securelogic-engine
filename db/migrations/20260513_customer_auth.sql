-- Migration: customer_auth
-- Package: customer-auth
-- Depends on: 001_securelogic_platform (organizations table)
--
-- Adds the users table for email/password customer authentication.
-- Also adds promo_code column to organizations for Stripe promotional pricing.
--
-- users.email is globally unique — one account per email address.
-- users.organization_id FK: each user belongs to exactly one org.
-- Token columns are nullable; set only during active verification/reset flows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. promo_code on organizations
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS promo_code TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. users table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email                          TEXT         NOT NULL,
  name                           TEXT         NOT NULL,
  password_hash                  TEXT         NOT NULL,

  -- Email verification
  email_verified                 BOOLEAN      NOT NULL DEFAULT FALSE,
  email_verification_token       TEXT,
  email_verification_expires_at  TIMESTAMPTZ,

  -- Password reset
  password_reset_token           TEXT,
  password_reset_expires_at      TIMESTAMPTZ,

  created_at                     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Global unique email constraint
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_email_unique;

ALTER TABLE users
  ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Index: token lookups (WHERE clause limits to non-null rows only)
CREATE INDEX IF NOT EXISTS users_email_verification_token_idx
  ON users (email_verification_token)
  WHERE email_verification_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_password_reset_token_idx
  ON users (password_reset_token)
  WHERE password_reset_token IS NOT NULL;

-- Index: org membership lookups
CREATE INDEX IF NOT EXISTS users_organization_id_idx
  ON users (organization_id);
