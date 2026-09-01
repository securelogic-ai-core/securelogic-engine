-- =====================================================================
-- ROLLBACK for 20261083 — evidence-validity policy (VA-S4 step 3)
-- =====================================================================
--
-- Reverses 20261083 completely: drops the platform policy table, the customer
-- settings table with its triggers, and returns validity_basis to the
-- three-value vocabulary 20261080 shipped.
--
-- SAFETY: this REFUSES to run if any evidence row is actually using
-- 'policy_default'. Silently rewriting a live window would destroy the
-- provenance of every determination that relied on it — the rollback's job is
-- to undo a deployment, never to launder data. Resolve those rows deliberately
-- first (re-establish them as artifact_dates, or clear them to
-- not_established) and re-run.

BEGIN;

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM evidence WHERE validity_basis = 'policy_default';
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING to roll back 20261083: % evidence row(s) carry validity_basis = ''policy_default''. Resolve them explicitly first.', n;
  END IF;
END $$;

-- 1. Customer layer
DROP TRIGGER IF EXISTS trg_org_evidence_validity_freeze
  ON organization_evidence_validity_settings;
DROP TRIGGER IF EXISTS trg_org_evidence_validity_guardrail
  ON organization_evidence_validity_settings;
DROP FUNCTION IF EXISTS org_evidence_validity_freeze();
DROP FUNCTION IF EXISTS org_evidence_validity_guardrail();
DROP TABLE IF EXISTS organization_evidence_validity_settings;

-- 2. Platform layer
DROP TABLE IF EXISTS evidence_validity_policy;

-- 3. validity_basis back to the 20261080 vocabulary and shape
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_validity_basis_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_validity_basis_check CHECK (
    validity_basis IN ('not_established', 'artifact_dates', 'perpetual')
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_validity_shape_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_validity_shape_check CHECK (
    (validity_basis = 'not_established'
       AND valid_from IS NULL AND valid_until IS NULL)
    OR
    (validity_basis = 'artifact_dates'  AND valid_until IS NOT NULL)
    OR
    (validity_basis = 'perpetual'       AND valid_until IS NULL)
  );

COMMENT ON COLUMN evidence.validity_basis IS
  'WHY this row''s window is what it is. not_established = unknown, the '
  'fail-closed default every pre-existing row carries; artifact_dates = a human '
  'committed a window the artifact itself states; perpetual = the artifact '
  'asserts no end (a contract until terminated). Step 3 will add a '
  'policy_default value when durations are ratified — not before.';

COMMIT;

-- NOTE: the schema_migrations row is deliberately left in place, matching
-- ROLLBACK-20261080..82. `scripts/runMigrations.ts` keys that table by
-- `filename`; removing the row here would make a re-run re-apply the migration
-- silently. Remove it explicitly, and only when a re-apply is what you want:
--
--   DELETE FROM schema_migrations
--    WHERE filename = '20261083_evidence_validity_policy.sql';
