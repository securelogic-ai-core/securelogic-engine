-- 20260915_enterprise_seat_model.sql
-- Enterprise seat program — Phase 1: seat type as data.
--
-- Additive and backward-compatible. There is intentionally ZERO behaviour
-- change from this migration:
--   * every existing user is backfilled to seat_type='full' by the column
--     default, so per-class counting equals whole-org counting today;
--   * the new per-class caps are NULL, meaning "use the computed default",
--     which is only consulted once Phase 4 enforces per class;
--   * assigned_to_user_id is nullable with no backfill — an unassigned
--     assessment is simply Full-only work until someone assigns it.
--
-- Seat vocabulary: 'full' (paid governance), 'contributor' (included, scoped),
-- 'viewer' (included, read-only). Seat type is a distinct axis from role and
-- must never be inferred from it.
--
-- assigned_to_user_id records WHO WAS ASKED. It is deliberately separate from
-- the existing completion-attribution columns (assessed_by / reviewer_id /
-- reviewer_uuid / created_by), which record WHO ANSWERED. Conflating the two
-- would destroy an audit distinction a GRC platform must keep.
--
-- Rollback (manual, forward-only convention):
--   ALTER TABLE users DROP COLUMN seat_type; (and the peers below)
--   -- Safe: every column added here is additive and unread by prior code.

-- ── 1. Seat type on users ────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS seat_type TEXT NOT NULL DEFAULT 'full';

-- ── 2. Seat type carried on an invitation (the invite decides the seat) ───────
ALTER TABLE org_invites
  ADD COLUMN IF NOT EXISTS seat_type TEXT NOT NULL DEFAULT 'full';

-- ── 3. Per-class seat caps on the organization ───────────────────────────────
-- NULL = "use the computed default" (multiplier of purchased Full seats with a
-- floor; see seatLimit.ts). Stored per org and administratively adjustable.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS max_contributor_seats INTEGER,
  ADD COLUMN IF NOT EXISTS max_viewer_seats      INTEGER;

-- ── 4. Seat vocabulary CHECK constraints (idempotent) ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_seat_type_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_seat_type_check
      CHECK (seat_type IN ('full', 'contributor', 'viewer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_invites_seat_type_check') THEN
    ALTER TABLE org_invites ADD CONSTRAINT org_invites_seat_type_check
      CHECK (seat_type IN ('full', 'contributor', 'viewer'));
  END IF;
END $$;

-- ── 5. Per-class counting index ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_org_seat_type
  ON users (organization_id, seat_type)
  WHERE status = 'active';

-- ── 6. Assignment predicate on the eight assessment/response tables ──────────
-- ON DELETE SET NULL: assignment is operational bookkeeping, not decision
-- content; a deleted assignee clears the assignment rather than the record.
ALTER TABLE requirement_responses  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE control_assessments    ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE vendor_reviews         ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE governance_reviews     ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE obligation_assessments ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE dependency_assessments ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE vendor_assessments     ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE assessments            ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ── 7. "Assigned to me" partial indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_requirement_responses_assigned  ON requirement_responses  (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_control_assessments_assigned    ON control_assessments    (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_assigned         ON vendor_reviews         (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_governance_reviews_assigned     ON governance_reviews     (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obligation_assessments_assigned ON obligation_assessments (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dependency_assessments_assigned ON dependency_assessments (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_assessments_assigned     ON vendor_assessments     (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assessments_assigned            ON assessments            (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;

COMMENT ON COLUMN users.seat_type IS
  'Enterprise seat class: full (paid governance) | contributor (included, scoped) | viewer (included, read-only). Distinct axis from role; never inferred from it.';
COMMENT ON COLUMN requirement_responses.assigned_to_user_id IS
  'Who was ASKED to complete this (assignment). Distinct from assessed_by, which records who ANSWERED. Nullable; NULL = unassigned = Full-only work.';
