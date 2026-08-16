-- 20261012_evidence_source_type_restore.sql
--
-- Restore the two evidence source types 20260925 deleted by accident.
--
-- THE DEFECT
-- ----------
-- 20260925_vendor_portal_evidence_comments.sql needed to add 'vendor_engagement'
-- to evidence_source_type_check. Instead of extending the constraint it rewrote
-- the whole value list from a STALE copy — one that predated two migrations that
-- had already widened it:
--
--   20260810_asset_assessments.sql        added 'asset_assessment'
--   20260907_finding_risk_acceptances.sql added 'finding_risk_acceptance'
--
-- The rewrite therefore ADDED one value and silently REMOVED those two. Measured
-- on a real database (C-8 rehearsal, 2026-08-16) by diffing the constraint before
-- and after 20260925: removed = {asset_assessment, finding_risk_acceptance},
-- added = {vendor_engagement}. 20260925 is the LAST migration to touch this
-- constraint, so its list is what every migrated environment carries today.
--
-- WHY THIS IS NOT COSMETIC
-- ------------------------
-- ADD CONSTRAINT ... CHECK validates existing rows. On any database holding an
-- evidence row with either removed value, 20260925 does not warn — it ABORTS:
--
--   ERROR: check constraint "evidence_source_type_check" of relation "evidence"
--          is violated by some row
--
-- The engine's startCommand is `npm run migrate && npm start`, so that is not a
-- failed migration, it is a service that will not start. Staging survived only
-- because it happened to hold no such row. 20260907 documents the value as the
-- intended mechanism — "Evidence for an acceptance attaches as
-- evidence.source_type='finding_risk_acceptance'" — so the vocabulary is real,
-- not vestigial, and the capability is unusable while the value is illegal.
--
-- WHY A NEW MIGRATION AND NOT AN EDIT
-- -----------------------------------
-- 20260925 is already recorded in schema_migrations on staging. Editing it would
-- change nothing there (the runner is filename-keyed and never re-runs a
-- recorded file) while quietly changing what a from-scratch rebuild produces —
-- two environments diverging with no record of why. Forward-only is the only
-- honest fix.
--
-- SCOPE — deliberately minimal
-- ----------------------------
-- The list below is EXACTLY the eleven values currently legal, plus the two
-- being restored. Thirteen. Nothing else is added, and nothing is removed:
-- 'vendor_engagement' stays, because it is legitimately in use by the vendor
-- assurance engagement spine.
--
-- SAFETY
-- ------
-- - Idempotent: DROP ... IF EXISTS then ADD. Re-running is a no-op in effect.
-- - Strictly WIDENING, so no existing row can fail validation and no rewrite
--   occurs — the scan is a validation pass, not a table rewrite.
-- - Touches no data. Nothing is deleted, rewritten, or normalised.
-- - Alters no RLS, no policy, no ownership, no index.
-- - Brief ACCESS EXCLUSIVE on evidence, bounded by the runner's lock_timeout
--   (5s default) and statement_timeout (300s) since b363e144.
--
-- ROLLBACK
-- --------
-- Reverting would re-break the two capabilities and re-introduce a migration
-- that can abort on arrival, so there is no rollback worth naming. If one is
-- ever required for forensic reasons, re-apply the eleven-value list from
-- 20260925 — and only after proving no evidence row uses either restored value.

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
    'risk',
    'vendor_engagement',
    -- Restored below. Removed unintentionally by 20260925.
    'asset_assessment',          -- 20260810_asset_assessments.sql
    'finding_risk_acceptance'    -- 20260907_finding_risk_acceptances.sql
  ));
