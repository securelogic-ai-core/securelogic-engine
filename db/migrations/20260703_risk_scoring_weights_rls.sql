-- 20260703_risk_scoring_weights_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on risk_scoring_weights.
-- First core-entity-layer table enabled after the aggregator-wrap prerequisite.
--
-- Safe to enable now: every reader and writer is tenant-safe at the
-- owner->app_request DATABASE_URL flip:
--   - riskScoringWeights.ts (GET + PUT — the only writer) is asTenant()-wrapped.
--   - signalMatchSuggestions.ts recompute reads the weights inside its
--     asTenant()-wrapped handler (tenant-scoped).
--   - cyberSignalProcessingService.ts reads the weights on pgElevated, which
--     bypasses RLS (owner) — unaffected by the policy.
-- Preserves the "policy => readers+writers tenant-safe" invariant.
--
-- One row per org: organization_id is NOT NULL + UNIQUE. NOT FORCE — owner
-- bypasses; INERT until the flip.

ALTER TABLE risk_scoring_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_scoring_weights_tenant_isolation ON risk_scoring_weights;

CREATE POLICY risk_scoring_weights_tenant_isolation ON risk_scoring_weights
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
