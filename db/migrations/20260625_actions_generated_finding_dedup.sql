-- Migration: actions_generated_finding_dedup
-- GAP-3 increment 1 — idempotency for auto-generated finding-actions.
--
-- The action-recommendation engine (actionRecommendationEngine.ts) generates one
-- "review and remediate" action per high-signal finding, stamped with
-- action_type = 'auto_finding_remediation'. This partial unique index lets the
-- matcher INSERT ... ON CONFLICT DO NOTHING so re-processing a signal never
-- duplicates the action.
--
-- PARTIAL on action_type = the generated marker: it constrains ONLY generated
-- rows. A user's MANUAL action with source_type='finding' on the same finding
-- (different/NULL action_type) is NOT covered, so manual and generated
-- finding-actions coexist without collision.
--
-- Additive, no backfill, reversible:
--   DROP INDEX IF EXISTS idx_actions_generated_finding;

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_generated_finding
  ON actions (organization_id, source_type, source_id)
  WHERE action_type = 'auto_finding_remediation';
