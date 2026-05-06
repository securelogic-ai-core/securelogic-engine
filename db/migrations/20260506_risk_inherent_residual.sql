-- Migration: risk_inherent_residual
-- Package: risk-register-inherent-residual-rating (Phase 1 of 4)
-- Depends on: risk_register_primitives (risks table)
--
-- Splits the single rating dimension on `risks` into TWO: inherent
-- (pre-controls / worst-case) and residual (post-controls / current
-- state). The original `likelihood`, `impact`, `risk_rating` columns
-- STAY in place — they become "legacy" columns kept in sync with the
-- residual values on every write so existing webhook consumers and
-- read paths continue to function unchanged.
--
-- Existing data interpretation (locked product decision §3):
--   The pre-package risk_rating value is interpreted as RESIDUAL.
--   Backfill copies legacy → residual_*. Inherent fields start NULL on
--   existing rows; users fill them in over time as they reassess.
--
-- Posture engine consumption (locked decision §4): residual only.
--   The engine read sites in postureSnapshot.ts and
--   cyberSignalProcessingService.ts will switch to residual_rating in
--   Phase 2. The IS NOT NULL filter implements the fallback rule:
--   a risk with no residual rating contributes no signal to the engine.
--
-- Webhook compatibility (locked decision §5):
--   The legacy risk_rating column stays. Webhook payloads continue to
--   include `risk_rating` mapped from residual. Documented as
--   deprecated; removal is a future major version.
--
-- All ALTERs, CHECKs, and the UPDATE are idempotent. The migration is
-- safe to re-run on a partially-applied schema. The original three
-- columns are NOT dropped — a separate cleanup package will decide.

-- ============================================================
-- 1. Add the six new columns (nullable initially)
-- ============================================================

ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS inherent_likelihood TEXT,
  ADD COLUMN IF NOT EXISTS inherent_impact     TEXT,
  ADD COLUMN IF NOT EXISTS inherent_rating     TEXT,
  ADD COLUMN IF NOT EXISTS residual_likelihood TEXT,
  ADD COLUMN IF NOT EXISTS residual_impact     TEXT,
  ADD COLUMN IF NOT EXISTS residual_rating     TEXT;

-- ============================================================
-- 2. CHECK constraints — mirror the existing ones
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'risks'
      AND constraint_name = 'risk_inherent_likelihood_check'
  ) THEN
    ALTER TABLE risks
      ADD CONSTRAINT risk_inherent_likelihood_check CHECK (
        inherent_likelihood IS NULL OR
        inherent_likelihood IN ('very_likely', 'likely', 'possible', 'unlikely', 'rare')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'risks'
      AND constraint_name = 'risk_inherent_impact_check'
  ) THEN
    ALTER TABLE risks
      ADD CONSTRAINT risk_inherent_impact_check CHECK (
        inherent_impact IS NULL OR
        inherent_impact IN ('Critical', 'High', 'Moderate', 'Low')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'risks'
      AND constraint_name = 'risk_inherent_rating_check'
  ) THEN
    ALTER TABLE risks
      ADD CONSTRAINT risk_inherent_rating_check CHECK (
        inherent_rating IS NULL OR
        inherent_rating IN ('Critical', 'High', 'Moderate', 'Low')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'risks'
      AND constraint_name = 'risk_residual_likelihood_check'
  ) THEN
    ALTER TABLE risks
      ADD CONSTRAINT risk_residual_likelihood_check CHECK (
        residual_likelihood IS NULL OR
        residual_likelihood IN ('very_likely', 'likely', 'possible', 'unlikely', 'rare')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'risks'
      AND constraint_name = 'risk_residual_impact_check'
  ) THEN
    ALTER TABLE risks
      ADD CONSTRAINT risk_residual_impact_check CHECK (
        residual_impact IS NULL OR
        residual_impact IN ('Critical', 'High', 'Moderate', 'Low')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'risks'
      AND constraint_name = 'risk_residual_rating_check'
  ) THEN
    ALTER TABLE risks
      ADD CONSTRAINT risk_residual_rating_check CHECK (
        residual_rating IS NULL OR
        residual_rating IN ('Critical', 'High', 'Moderate', 'Low')
      );
  END IF;
END;
$$;

-- ============================================================
-- 3. Backfill: residual_* = legacy values for existing rows
-- ============================================================
--
-- Only updates rows where residual_rating IS NULL — makes the
-- migration safe to re-run without overwriting any data already
-- entered through the new code path.

UPDATE risks SET
  residual_likelihood = likelihood,
  residual_impact     = impact,
  residual_rating     = risk_rating
WHERE residual_rating IS NULL;

-- Inherent columns are intentionally NOT backfilled. Existing rows
-- have NULL inherent values, signalling "we don't have a pre-controls
-- assessment for this risk yet." Users fill in inherent over time
-- through the new UI.

-- ============================================================
-- 4. Indexes — partial indexes on the residual rating, since the
-- engine and dashboard heatmap will both filter on it.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_risks_org_residual_rating
  ON risks (organization_id, residual_rating)
  WHERE residual_rating IS NOT NULL;

-- ============================================================
-- 5. Verification queries (run after applying):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'risks'
--      AND column_name LIKE 'inherent_%' OR column_name LIKE 'residual_%';
--
--   SELECT COUNT(*) FROM risks WHERE residual_rating IS NULL;
--   -- expected: 0 after backfill (every existing row has residual now)
--
--   SELECT COUNT(*) FROM risks WHERE inherent_rating IS NULL;
--   -- expected: count of all existing rows (none have inherent yet)
-- ============================================================
