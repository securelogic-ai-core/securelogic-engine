-- Migration: acceptance_expiring_notified
-- Package: Webhook wave 1 (DS-15, issue #694 step 5) — acceptance.expiring
--
-- Adds the at-most-once marker for the expiry worker's advance-warning phase:
-- an approved acceptance inside the warning window is CLAIMED (this column set)
-- in the same statement that selects it, then the acceptance.expiring webhook
-- is emitted post-commit. A re-run finds nothing to claim, so the event fires
-- at most once per acceptance lifetime; a re-accepted finding gets a NEW
-- acceptance row and therefore its own warning.
--
-- WORM note: the finding_risk_acceptances immutability trigger
-- (20260907, finding_risk_acceptances_enforce_worm) freezes the DECISION
-- content by explicit column list; operational bookkeeping columns added after
-- it (like promoted_risk_id, and this one) remain writable by design. This is
-- delivery bookkeeping, not decision content.
--
-- Additive only. Rollback (manual, forward-only convention):
--   ALTER TABLE finding_risk_acceptances DROP COLUMN expiring_notified_at;

ALTER TABLE finding_risk_acceptances
  ADD COLUMN IF NOT EXISTS expiring_notified_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN finding_risk_acceptances.expiring_notified_at IS
  'When the acceptance.expiring advance warning (webhook wave 1) was claimed for this acceptance. NULL = not yet warned. Set once by the expiry worker''s warning phase; at-most-once delivery marker, not decision content.';

-- The warning phase's org-discovery and claim queries filter on
-- (state, expires_at, expiring_notified_at IS NULL); this partial index keeps
-- the hourly tick cheap when nothing is inside the window.
CREATE INDEX IF NOT EXISTS finding_risk_acceptances_expiring_unnotified
  ON finding_risk_acceptances (organization_id, expires_at)
  WHERE state = 'approved' AND expiring_notified_at IS NULL;
