-- ============================================================
-- 20260715_risk_settings_approval.sql — Risk lifecycle (Epic R1 scaffold)
--
-- Adds org-level approval-model policy to risk_settings (one row per org):
--
--   * approval_threshold_score  — the score-threshold approver model (Q1 option
--     b). Ships NULL/unused in R1: while NULL, ALL treatment plans require
--     approval under the designated-approver model (option a). When later set
--     (0–100), only risks with residual_score >= threshold require the
--     pending_approval state. Layering (b) on is a config change, not a
--     migration.
--   * require_evidence_gate     — whether the "evidence-required" gate is
--     enforced (default FALSE ⇒ advisory) when advancing scoping ->
--     treatment_selection.
--
-- See docs/specs/risk-lifecycle-spec.md §7.4 + "Decisions (R1)" Q1.
-- risk_settings already has RLS enabled (20260703_risk_settings_rls.sql) — new
-- columns are covered by the existing row-level policy. Additive; idempotent.
-- ============================================================

ALTER TABLE risk_settings
  ADD COLUMN IF NOT EXISTS approval_threshold_score INTEGER NULL,
  ADD COLUMN IF NOT EXISTS require_evidence_gate    BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE risk_settings
  DROP CONSTRAINT IF EXISTS risk_settings_approval_threshold_range;
ALTER TABLE risk_settings
  ADD CONSTRAINT risk_settings_approval_threshold_range CHECK (
    approval_threshold_score IS NULL OR (approval_threshold_score BETWEEN 0 AND 100)
  );

COMMENT ON COLUMN risk_settings.approval_threshold_score IS
  'Score-threshold approver model (Q1 option b). NULL ⇒ all treatment plans '
  'require approval (option a). See docs/specs/risk-lifecycle-spec.md §7.4.';
COMMENT ON COLUMN risk_settings.require_evidence_gate IS
  'When true, the evidence-required gate blocks scoping->treatment_selection. '
  'Default false (advisory). See docs/specs/risk-lifecycle-spec.md §3.3.';
