-- Migration: actions_generated_risk_dedup
-- GAP-3 increment 2 — idempotency for auto-generated risk-exposure actions.
--
-- The action engine generates one "review exposed risk" action per risk newly
-- exposure-flagged by a signal, stamped action_type = 'auto_risk_exposure'.
-- This partial unique index lets processSignal INSERT ... ON CONFLICT DO NOTHING
-- so re-processing never duplicates the action. Partial on the marker, so a
-- user's MANUAL risk-action (different/NULL action_type) never collides.
--
-- Additive, no backfill, reversible: DROP INDEX IF EXISTS idx_actions_generated_risk;

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_generated_risk
  ON actions (organization_id, source_type, source_id)
  WHERE action_type = 'auto_risk_exposure';
