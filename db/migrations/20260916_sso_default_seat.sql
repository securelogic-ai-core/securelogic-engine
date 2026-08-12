-- 20260916_sso_default_seat.sql
-- Enterprise seat program — Phase 4: per-organization SSO JIT defaults.
--
-- Before the seat model, SSO just-in-time provisioning minted every new user
-- as an 'analyst' with no seat type, so the column default made them a FULL
-- seat: a first SSO login silently consumed a paid seat. These columns let an
-- organization choose what a JIT-provisioned user becomes; the default is the
-- safest possible — a read-only Viewer seat — so SSO can never silently consume
-- a Full seat again.
--
-- Additive and backward-compatible: the values are consulted ONLY when
-- SECURELOGIC_SEAT_MODEL_ENABLED is on (see sso.ts). With the flag off, SSO JIT
-- behaves exactly as before.
--
-- Rollback (manual, forward-only):
--   ALTER TABLE organizations DROP COLUMN default_sso_seat_type, DROP COLUMN default_sso_role;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_sso_seat_type TEXT NOT NULL DEFAULT 'viewer',
  ADD COLUMN IF NOT EXISTS default_sso_role      TEXT NOT NULL DEFAULT 'viewer';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_default_sso_seat_type_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_default_sso_seat_type_check
      CHECK (default_sso_seat_type IN ('full', 'contributor', 'viewer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_default_sso_role_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_default_sso_role_check
      CHECK (default_sso_role IN ('admin', 'analyst', 'viewer'));
  END IF;
END $$;

COMMENT ON COLUMN organizations.default_sso_seat_type IS
  'Seat class assigned to a SSO JIT-provisioned user. Default viewer so SSO never silently consumes a Full seat. Consulted only when the seat model is enabled.';
