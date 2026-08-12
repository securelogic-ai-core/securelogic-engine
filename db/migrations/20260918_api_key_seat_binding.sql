-- 20260918_api_key_seat_binding.sql
-- Enterprise seat program — activation blocker 2: bind API keys to their
-- issuer's seat + role, closing the "API key = admin-level" bypass.
--
-- Before this, an org API key authenticated with NO role, and requireRole
-- treated "no role" as admin — so a key minted by any user acted admin-level.
-- These columns let requireApiKey resolve a key to the seat/role it was issued
-- under.
--
-- Nullable with no default. NULL means a LEGACY key (created before this
-- migration): it keeps the pre-binding admin-level behaviour during the
-- compatibility window, until it is rotated to a bound key. New keys record the
-- issuer's resolved seat/role.
--
-- Consulted ONLY when SECURELOGIC_SEAT_MODEL_ENABLED is on (see requireApiKey),
-- so with the flag off every key stays admin-level exactly as today.
--
-- Rollback (manual, forward-only):
--   ALTER TABLE api_keys DROP COLUMN bound_seat_type, DROP COLUMN bound_role;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS bound_seat_type TEXT,
  ADD COLUMN IF NOT EXISTS bound_role      TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_bound_seat_type_check') THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_bound_seat_type_check
      CHECK (bound_seat_type IS NULL OR bound_seat_type IN ('full', 'contributor', 'viewer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_bound_role_check') THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_bound_role_check
      CHECK (bound_role IS NULL OR bound_role IN ('admin', 'analyst', 'viewer'));
  END IF;
END $$;

COMMENT ON COLUMN api_keys.bound_seat_type IS
  'Seat class the key was issued under. NULL = legacy key (admin-level compat until rotated). Consulted only when the seat model is enabled.';
