-- Migration: sso_config
-- Sprint 15 — SAML 2.0 SSO
-- Depends on: 001_securelogic_platform (organizations), 20260513_customer_auth (users)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. org_sso_configs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_sso_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  idp_entity_id     TEXT NOT NULL,
  idp_sso_url       TEXT NOT NULL,
  idp_certificate   TEXT NOT NULL,
  sp_entity_id      TEXT NOT NULL,
  is_enforced       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_sso_configs_org
  ON org_sso_configs(organization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. sso_provider column on users
--    'saml' when user was JIT-created via SSO; NULL for password users.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sso_provider TEXT;
