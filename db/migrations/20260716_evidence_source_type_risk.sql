-- ============================================================
-- 20260716_evidence_source_type_risk.sql — Risk lifecycle (Epic R4)
--
-- Lets evidence attach directly to a risk (source_type='risk', source_id=risk.id)
-- so the risk-lifecycle evidence gate (advance_to_treatment) can be satisfied by
-- risk-level assessment evidence. Reuses the shared, write-once `evidence` table
-- and its org-scoped RLS (20260705_evidence_rls.sql) — NOT a parallel store.
-- See docs/specs/risk-lifecycle-spec.md §10 (R4).
--
-- Two additive changes:
--   1. Extend evidence_source_type_check to include 'risk'.
--   2. Add nullable `detached_at`. Evidence is otherwise write-once; R4 introduces
--      a SOFT detach for risk-attached evidence only (the risk-scoped DELETE route
--      sets detached_at instead of removing the row, preserving the audit trail).
--      Every existing consumer treats detached_at as always-NULL, so their behavior
--      is unchanged. A detached row is excluded from risk-evidence lists and from
--      the has_evidence gate.
--
-- ADDITIVE + INERT: the new source_type value is unused and detached_at defaults
-- to NULL until SECURELOGIC_RISK_LIFECYCLE_ENABLED exposes the risk-scoped evidence
-- routes. Idempotent (DROP+ADD constraint / IF NOT EXISTS); safe to re-run.
-- evidence already has RLS (20260705) — a new column needs no policy work.
-- ============================================================

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_source_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_type_check
  CHECK (source_type IN (
    'control_test',
    'vendor_review',
    'ai_review',
    'obligation_review',
    'ai_governance_review',
    'dependency_review',
    'risk_treatment',
    'finding',
    'policy_review',
    'risk'
  ));

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS detached_at TIMESTAMPTZ NULL;

-- Fast lookup of live (non-detached) risk evidence for a risk — the list route
-- and the has_evidence gate both filter on (source_type, source_id, detached_at).
CREATE INDEX IF NOT EXISTS idx_evidence_org_source_live
  ON evidence (organization_id, source_type, source_id)
  WHERE detached_at IS NULL;

COMMENT ON COLUMN evidence.detached_at IS
  'Soft-detach timestamp for risk-attached evidence (Epic R4). NULL = attached. '
  'Only the risk-scoped evidence DELETE route sets this; all other source types '
  'remain write-once and always NULL. See docs/specs/risk-lifecycle-spec.md.';
