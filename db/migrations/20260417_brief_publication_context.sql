-- Brief Publication Context
--
-- Adds a single JSONB column to newsletter_issues to store a snapshot of the
-- platform's posture/risk state at the moment an issue is published (status
-- transitions to 'sent').
--
-- Design decisions:
--   - Nullable. Existing rows and platform-wide briefs (org IS NULL) retain NULL.
--   - NULL is treated by the read layer as "no platform context available" — not an error.
--   - The snapshot is written once on publication and never overwritten on
--     subsequent status-preserving updates (idempotent write guard in app layer).
--   - No FK constraint to posture_snapshots — snapshot rows may be pruned
--     independently and we want the captured context to survive that.

ALTER TABLE newsletter_issues
  ADD COLUMN IF NOT EXISTS publication_context_json JSONB;
