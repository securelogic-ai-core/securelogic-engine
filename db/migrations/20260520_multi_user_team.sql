-- Migration: multi_user_team
-- Sprint 7 — Multi-User Team Access
-- Depends on: 001_securelogic_platform, 20260513_customer_auth

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add entitlement_level to organizations
--    Synced from api_keys for existing rows.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS entitlement_level TEXT NOT NULL DEFAULT 'starter';

UPDATE organizations o
SET entitlement_level = ak.entitlement_level
FROM api_keys ak
WHERE ak.organization_id = o.id
  AND ak.status = 'active'
  AND ak.revoked_at IS NULL
  AND ak.created_at = (
    SELECT MIN(ak2.created_at)
    FROM api_keys ak2
    WHERE ak2.organization_id = o.id
      AND ak2.status = 'active'
      AND ak2.revoked_at IS NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add seat limit to organizations
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS max_members INTEGER NOT NULL DEFAULT 10;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. org_invites table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_invites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'analyst',
  token               TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending',
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_org_invites_token
  ON org_invites(token);

CREATE INDEX IF NOT EXISTS idx_org_invites_org
  ON org_invites(organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invites_org_email_pending
  ON org_invites(organization_id, email)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Role index on users
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_org_role
  ON users(organization_id, role);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Ensure signup-created users default to 'admin' role
--    (existing single-user orgs: the only member is the admin)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE users u
SET role = 'admin'
WHERE u.role = 'member'
  AND (
    SELECT COUNT(*) FROM users u2
    WHERE u2.organization_id = u.organization_id
      AND u2.status = 'active'
  ) = 1;
