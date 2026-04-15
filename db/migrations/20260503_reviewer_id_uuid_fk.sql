-- 20260503_reviewer_id_uuid_fk.sql
--
-- Adds reviewer_uuid UUID FK → users(id) to the five workflow tables that
-- currently store reviewer_id as TEXT with no foreign-key constraint.
--
-- Strategy: non-breaking addition only.
--   • reviewer_uuid (UUID, nullable) is added alongside the existing TEXT column.
--   • reviewer_id TEXT is NOT dropped — callers must migrate before that column
--     is removed.
--   • A COMMENT marks reviewer_id as deprecated on each affected table.
--
-- Affected tables:
--   1. obligation_assessments
--   2. dependency_reviews
--   3. risk_treatments
--   4. vendor_reviews
--   5. ai_governance_reviews

-- ── 1. obligation_assessments ────────────────────────────────────────────────

ALTER TABLE obligation_assessments
  ADD COLUMN reviewer_uuid UUID NULL REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN obligation_assessments.reviewer_id IS
  'DEPRECATED: use reviewer_uuid (UUID FK → users.id) instead. '
  'This TEXT column will be removed in a future migration.';

-- ── 2. dependency_reviews ────────────────────────────────────────────────────

ALTER TABLE dependency_reviews
  ADD COLUMN reviewer_uuid UUID NULL REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN dependency_reviews.reviewer_id IS
  'DEPRECATED: use reviewer_uuid (UUID FK → users.id) instead. '
  'This TEXT column will be removed in a future migration.';

-- ── 3. risk_treatments ───────────────────────────────────────────────────────

ALTER TABLE risk_treatments
  ADD COLUMN reviewer_uuid UUID NULL REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN risk_treatments.reviewer_id IS
  'DEPRECATED: use reviewer_uuid (UUID FK → users.id) instead. '
  'This TEXT column will be removed in a future migration.';

-- ── 4. vendor_reviews ────────────────────────────────────────────────────────

ALTER TABLE vendor_reviews
  ADD COLUMN reviewer_uuid UUID NULL REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN vendor_reviews.reviewer_id IS
  'DEPRECATED: use reviewer_uuid (UUID FK → users.id) instead. '
  'This TEXT column will be removed in a future migration.';

-- ── 5. ai_governance_reviews ─────────────────────────────────────────────────

ALTER TABLE ai_governance_reviews
  ADD COLUMN reviewer_uuid UUID NULL REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN ai_governance_reviews.reviewer_id IS
  'DEPRECATED: use reviewer_uuid (UUID FK → users.id) instead. '
  'This TEXT column will be removed in a future migration.';
