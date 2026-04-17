-- Migration: control_testing_cadence
-- Adds testing cadence tracking to controls.
--
-- New columns:
--   testing_frequency — one of five cadence options (nullable = not configured)
--   next_test_due     — computed or manually overridden next test date
--   last_tested_at    — denormalized from latest passed assessment.performed_at

ALTER TABLE controls
  ADD COLUMN IF NOT EXISTS testing_frequency TEXT
    CHECK (testing_frequency IN ('monthly', 'quarterly', 'biannual', 'annual', 'ad_hoc')),
  ADD COLUMN IF NOT EXISTS next_test_due DATE,
  ADD COLUMN IF NOT EXISTS last_tested_at DATE;

-- Fast lookup for overdue dashboard query
CREATE INDEX IF NOT EXISTS idx_controls_next_test_due
  ON controls (organization_id, next_test_due)
  WHERE next_test_due IS NOT NULL;

-- Note: overdue check (next_test_due < CURRENT_DATE) happens at query time.
-- The idx_controls_next_test_due index above is sufficient for performance.
