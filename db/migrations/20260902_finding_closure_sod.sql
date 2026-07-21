-- ============================================================
-- 20260902_finding_closure_sod.sql — separation of duties on finding closure
--
-- finding-lifecycle-spec §7: "Every governance transition is entitlement-gated
-- + audited; separation-of-duties where the Risk lifecycle requires it." The
-- Risk lifecycle enforces approver ≠ proposer (risk_approvals + the
-- separation_of_duties gate in riskLifecycleStateMachine). Findings had NO
-- equivalent: the same analyst could create the finding, complete the
-- remediation Actions, and set decision_state='resolved' — self-approved
-- closure, an audit finding for any SOX/ISO-audited customer.
--
-- Org policy column on risk_settings (the org's risk-governance policy object,
-- same home as require_evidence_gate). Default FALSE — no behavior change
-- until an org opts in. When TRUE, the close transition (decision_state →
-- 'resolved') requires an identified session actor who is NOT the actor of
-- the finding's most recent operational→remediated lifecycle event.
--
-- Additive; idempotent. Reversible:
--   ALTER TABLE risk_settings DROP COLUMN IF EXISTS require_finding_closure_sod;
-- ============================================================

ALTER TABLE risk_settings
  ADD COLUMN IF NOT EXISTS require_finding_closure_sod BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN risk_settings.require_finding_closure_sod IS
  'When TRUE, decision_state=resolved on a finding requires an identified session actor different from the actor who completed the remediation (last operational->remediated lifecycle event). Mirrors the Risk lifecycle separation-of-duties gate. Default FALSE (no enforcement).';
