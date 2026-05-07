-- 20260607_risk_review_cadence.sql
--
-- RR-5 — Risk review cadence.
--
-- Adds three nullable columns to `risks` for per-risk review tracking, plus
-- a partial index for the overdue-dashboard read path. Also creates the
-- `risk_settings` table (one row per org) holding the org-level review
-- cadence policy by residual rating.
--
-- Mirrors the controls cadence pattern from 20260524_control_testing_cadence.sql:
--   * DATE columns (matches `controls.last_tested_at` / `next_test_due`)
--   * partial index on (org, next_review_due) WHERE NOT NULL
--   * `is_overdue` is COMPUTED at read time in RISK_SELECT, never stored.
--
-- D2: review_cadence_days is INTEGER (per-risk override). NULL falls back
-- to the org policy in risk_settings.cadence_by_rating[residual_rating],
-- which itself falls back to documented defaults if no row exists.
--
-- D3: risk_settings is a NEW table — does not extend risk_scoring_weights.
-- One row per org; cadence_by_rating is a JSONB map keyed by the residual
-- rating enum value.
--
-- Default policy (in code, not in the DB default — keeps the runtime
-- fallback logic in one place — src/api/lib/riskCadence.ts):
--   { Critical: 30, High: 60, Moderate: 90, Low: 180 }
--
-- Combined into a single migration file so the column additions and the
-- settings table land atomically in the same transaction. Splitting them
-- gains nothing and risks a partial-state failure that leaves the route
-- code with one half present.

-- ============================================================
-- 1. risks — add the three review-cadence columns + index
-- ============================================================

ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS last_reviewed_at     DATE,
  ADD COLUMN IF NOT EXISTS next_review_due      DATE,
  ADD COLUMN IF NOT EXISTS review_cadence_days  INTEGER;

-- review_cadence_days must be positive when set. NULL = use org policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'risks'
      AND constraint_name = 'risk_review_cadence_days_positive'
  ) THEN
    ALTER TABLE risks
      ADD CONSTRAINT risk_review_cadence_days_positive CHECK (
        review_cadence_days IS NULL OR review_cadence_days > 0
      );
  END IF;
END;
$$;

-- Hot read for the overdue-dashboard query and the "Overdue Reviews"
-- stat tile / list filter. Partial WHERE NOT NULL keeps the index small
-- (most rows on day-zero will not have a next_review_due set yet).
CREATE INDEX IF NOT EXISTS idx_risks_org_next_review_due
  ON risks (organization_id, next_review_due)
  WHERE next_review_due IS NOT NULL;

-- ============================================================
-- 2. risk_settings — org-level review-cadence policy
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_settings (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID         NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  cadence_by_rating   JSONB        NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by_user_id  UUID         NULL REFERENCES users(id) ON DELETE SET NULL
);

-- Org-scoped lookup. UNIQUE on organization_id already gives us the
-- primary access pattern, but an explicit index documents intent and
-- makes the EXPLAIN output unambiguous.
CREATE INDEX IF NOT EXISTS idx_risk_settings_org
  ON risk_settings (organization_id);

-- ============================================================
-- 3. Verification queries (run after applying):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'risks'
--      AND column_name IN ('last_reviewed_at','next_review_due','review_cadence_days');
--
--   SELECT to_regclass('risk_settings');     -- expected: risk_settings
--   SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('risks','risk_settings')
--      AND indexname LIKE '%review%';
-- ============================================================
