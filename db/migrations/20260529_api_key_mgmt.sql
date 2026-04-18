-- Migration: api_key_mgmt
-- Sprint 16 — Customer API Key Management
-- Depends on: 001_securelogic_platform (api_keys, organizations, users)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Track which user created each API key
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID
    REFERENCES users(id)
    ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Persistent daily usage tracking per API key
--    UPSERT target: (api_key_id, date) — updated on every authenticated request.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_usage_daily (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id       UUID        NOT NULL REFERENCES api_keys(id)      ON DELETE CASCADE,
  date             DATE        NOT NULL,
  request_count    INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(api_key_id, date)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_daily_org_date
  ON api_usage_daily(organization_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_daily_key_date
  ON api_usage_daily(api_key_id, date DESC);
