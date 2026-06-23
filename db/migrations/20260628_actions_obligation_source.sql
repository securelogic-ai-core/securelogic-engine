-- Migration: actions_obligation_source
-- GAP-3 increment 3 — allow obligation-linked actions + idempotency.
--
-- 1. Expand the actions.source_type CHECK to include 'obligation' (mirrors the
--    'risk' addition in 20260423). source_id carries the obligation UUID when
--    source_type = 'obligation'. No FK (consistent with the other source types).
-- 2. Partial unique index so the engine's INSERT ... ON CONFLICT DO NOTHING
--    generates one obligation-review action per (org, obligation). Partial on the
--    'auto_obligation_review' marker so a manual obligation-action never collides.
--
-- Additive, no backfill, reversible.

ALTER TABLE actions
  DROP CONSTRAINT IF EXISTS actions_source_type_check;

ALTER TABLE actions
  ADD CONSTRAINT actions_source_type_check
    CHECK (source_type IN ('assessment', 'finding', 'signal', 'manual', 'risk', 'obligation'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_generated_obligation
  ON actions (organization_id, source_type, source_id)
  WHERE action_type = 'auto_obligation_review';
