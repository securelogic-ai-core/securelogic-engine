-- Migration: vendor_engagement_monitoring
--
-- The last stage of the assurance chain: a decision is time-boxed, and the
-- engagement carries the machinery that brings it back.
--
-- Two independent triggers, both deterministic:
--
--   1. TIME.   next_review_due (set when monitoring starts) or
--              decision_expires_at (set at the decision) passes.
--   2. INTEL.  A human ACCEPTS a Critical/High signal-match against this
--              vendor after the decision was made. Pending suggestions never
--              trigger — an unreviewed machine guess must not page anyone.
--
-- Both are materialised claim-then-emit, mirroring the risk-acceptance expiry
-- precedent: the sweep UPDATE both selects and marks the row, so a crashed run
-- can never double-notify, and a re-run finds nothing left to claim.
--
-- `review_overdue_notified_at` / `reassessment_recommended_at` are CLEARED when
-- monitoring is (re)started with a fresh cadence — recording a completed
-- periodic review re-arms both triggers.

ALTER TABLE vendor_engagements
  ADD COLUMN IF NOT EXISTS review_overdue_notified_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reassessment_recommended_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reassessment_reason          TEXT        NULL;

COMMENT ON COLUMN vendor_engagements.reassessment_reason IS
  'Deterministic, plain-language statement of WHY reassessment was recommended '
  '(which trigger fired, with counts and severities). A recommendation a '
  'reviewer cannot interrogate is one they will ignore.';

-- The intelligence sweep's join: accepted vendor-matches for an org, by vendor.
-- Partial — pending and dismissed suggestions never participate.
CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_accepted_vendor
  ON signal_match_suggestions (organization_id, target_id, accepted_at)
  WHERE target_type = 'vendor' AND accepted_at IS NOT NULL;
