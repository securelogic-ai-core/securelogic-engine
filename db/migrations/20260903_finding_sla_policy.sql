-- ============================================================
-- 20260903_finding_sla_policy.sql — org SLA policy for finding due dates
--
-- The operational-architecture audit: "SLA/due dates are 100% manual — the
-- SLA Breached bucket is decorative without an SLA source." Every automated
-- finding-creation path (intelligence events, applicability, signals) left
-- due_date NULL, so at enterprise scale nothing was ever 'overdue' unless a
-- human hand-set dates one by one.
--
-- Org policy column on risk_settings (the org-governance policy object, same
-- home as cadence_by_rating / require_evidence_gate / require_finding_closure_sod):
-- a JSONB map of severity → days-to-due, e.g. {"Critical": 7, "High": 14,
-- "Moderate": 30, "Low": 90}. NULL (default) = no automation, behavior
-- unchanged. When set, finding-creation paths default due_date =
-- CURRENT_DATE + days for the finding's severity WHEN no explicit due date
-- was provided. Existing findings are never touched.
--
-- Additive; idempotent. Reversible:
--   ALTER TABLE risk_settings DROP COLUMN IF EXISTS finding_sla_by_severity;
-- ============================================================

ALTER TABLE risk_settings
  ADD COLUMN IF NOT EXISTS finding_sla_by_severity JSONB NULL;

COMMENT ON COLUMN risk_settings.finding_sla_by_severity IS
  'Org SLA policy: severity -> days-to-due map (e.g. {"Critical":7,"High":14,"Moderate":30,"Low":90}). NULL = no due-date automation. Applied at finding creation only, and only when no explicit due_date was provided.';
