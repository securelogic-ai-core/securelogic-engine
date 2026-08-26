-- 20261040_ai_review_overdue_marker.sql
--
-- AI Governance T2 follow-up: the overdue-review notification marker.
--
-- 20261037 gave ai_systems the vendor-engagement cadence pair
-- (review_cadence_days / next_review_due) and ruled that overdue is COMPUTED
-- AT READ (next_review_due < CURRENT_DATE) — posture never depends on a cron
-- job having fired. What was deferred was the NOTIFICATION: nothing tells
-- anyone the date has passed unless they happen to load the page.
--
-- This column completes the mirror of the vendor sibling (20260929):
-- materialised claim-then-notify. The sweep's UPDATE both selects and marks
-- the row, so a crashed run can never double-notify and a re-run finds
-- nothing left to claim. The marker is BOOKKEEPING, not governance state —
-- the sweep never touches next_review_due, never flips any decision, never
-- writes anything but this column (sweep notifies, never flips).
--
-- RE-ARM: the marker is CLEARED whenever the PATCH route writes
-- next_review_due — a fresh review date means the previous overdue
-- notification is answered, and the next lapse must notify again.
--
-- The sweep's enumeration rides 20261037's partial index
-- (organization_id, next_review_due) WHERE next_review_due IS NOT NULL;
-- overdue rows are a vanishing fraction of it, so no new index is needed.

ALTER TABLE ai_systems
  ADD COLUMN IF NOT EXISTS review_overdue_notified_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN ai_systems.review_overdue_notified_at IS
  'Claim marker for the overdue-review notification sweep (mirrors '
  'vendor_engagements.review_overdue_notified_at): set by the sweep when the '
  'overdue notification is recorded, cleared by the PATCH route whenever '
  'next_review_due is written. Bookkeeping only — overdue itself is always '
  'computed at read from next_review_due.';
