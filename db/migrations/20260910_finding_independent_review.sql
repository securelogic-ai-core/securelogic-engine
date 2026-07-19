-- ============================================================
-- 20260910_finding_independent_review.sql — Closure Owner / Governance Reviewer
--
-- Independent Governance Review workflow (operator /goal 2026-07-19). When an org
-- enforces separation of duties on finding closure (risk_settings.require_finding_closure_sod),
-- a finding that reaches operational_status='remediated' must be closed by someone OTHER
-- than the remediator. Today the remediator is offered a Resolved control that the engine
-- then refuses (409 separation_of_duties). This column lets the platform ROUTE the
-- governance decision to an assigned reviewer instead of inviting a dead action.
--
-- review_owner_user_id — the Closure Owner / Governance Reviewer for this finding.
--   DISTINCT from owner_user_id (the remediation owner): reusing owner_user_id would both
--   corrupt "My Work" and collapse the very separation of duties this feature enforces.
--   Auto-assigned (admin != remediator) when the finding reaches 'remediated' under the
--   SoD policy, with the SECURELOGIC_INDEPENDENT_REVIEW_ENABLED workflow flag on. Nullable:
--   an org with no eligible reviewer leaves it null and the finding still surfaces org-wide
--   in the review queue — the system never fabricates an assignment.
--
-- Mirrors the platform-wide owner_user_id FK pattern exactly (UUID FK users, ON DELETE SET
-- NULL). Same-org is enforced by the assignment query (selects a same-org admin), as with
-- owner_user_id — the FK alone does not constrain org.
--
-- Additive; idempotent. Reversible:
--   DROP INDEX IF EXISTS idx_findings_review_owner;
--   ALTER TABLE findings DROP COLUMN IF EXISTS review_owner_user_id;
-- ============================================================

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS review_owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN findings.review_owner_user_id IS
  'Independent governance reviewer (Closure Owner) assigned to validate/close a remediated finding under separation of duties. Distinct from owner_user_id (remediation owner). Auto-assigned admin != remediator when operational_status reaches remediated and risk_settings.require_finding_closure_sod is TRUE, gated by SECURELOGIC_INDEPENDENT_REVIEW_ENABLED. Nullable when no eligible reviewer exists.';

CREATE INDEX IF NOT EXISTS idx_findings_review_owner
  ON findings (review_owner_user_id);
