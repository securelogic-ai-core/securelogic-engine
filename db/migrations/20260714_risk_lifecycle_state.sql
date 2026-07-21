-- ============================================================
-- 20260714_risk_lifecycle_state.sql — Risk lifecycle (Epic R1)
--
-- Adds the persisted lifecycle state to risks. This is the authoritative
-- field for the formal, gated risk lifecycle (docs/specs/risk-lifecycle-spec.md
-- §2/§7.1 + "Decisions (R1)"). 9 persisted states; the 12 customer-facing
-- stages are a UI projection.
--
-- ADDITIVE + INERT: the column is nullable and defaults to NULL. A NULL row is
-- "not lifecycle-managed" and is treated as 'draft' by the read layer only when
-- SECURELOGIC_RISK_LIFECYCLE_ENABLED is on. When the flag is off, nothing reads
-- or writes this column and every existing risk route behaves exactly as today.
-- Legacy risks.status is UNCHANGED (still open/accepted/mitigated/closed/
-- transferred); lifecycle_state is a separate column, not a status expansion.
--
-- risks already has RLS enabled (20260620) — a new column needs no policy work.
-- Idempotent (IF NOT EXISTS / DROP+ADD constraint); safe to re-run.
-- ============================================================

ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NULL;

ALTER TABLE risks
  DROP CONSTRAINT IF EXISTS risk_lifecycle_state_check;
ALTER TABLE risks
  ADD CONSTRAINT risk_lifecycle_state_check CHECK (
    lifecycle_state IS NULL OR lifecycle_state IN (
      'draft',
      'scoping',
      'treatment_selection',
      'pending_approval',
      'mitigation',
      'validation',
      'residual_review',
      'closed',
      'archived'
    )
  );

CREATE INDEX IF NOT EXISTS idx_risks_org_lifecycle
  ON risks (organization_id, lifecycle_state);

COMMENT ON COLUMN risks.lifecycle_state IS
  'Persisted risk-lifecycle state (Epic R1). NULL = not lifecycle-managed '
  '(treated as draft when SECURELOGIC_RISK_LIFECYCLE_ENABLED is on). Distinct '
  'from status, which stays the legacy 5-value posture field. See '
  'docs/specs/risk-lifecycle-spec.md.';
