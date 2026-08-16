-- Rollback for 20260924, 20260925 and 20260928 — the three migrations in the
-- VA promotion set that cannot be reverted by dropping columns alone.
--
-- WRITTEN 2026-08-16 during the C-8 rehearsal. It did not exist before: the
-- promotion audit's C-8 row claimed "documented per migration" and the launch
-- runbook offered one line naming 20260925/20260927 — the wrong set, omitting
-- 20260924 and 20260928. There was nothing to rehearse, so this is the
-- procedure, written from the measured dependency graph of a real database.
--
-- RUN AS ONE TRANSACTION. Either the whole rollback lands or none of it does;
-- there is no half-rolled-back state to repair by hand.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f db/rollback/20260924_20260925_20260928_rollback.sql
--
-- ORDER IS REVERSE DEPENDENCY, NOT REVERSE DATE
-- ============================================================================
--   20260928 (findings)   -> 20260925 (evidence, comments) -> 20260924 (responses)
--
-- Within each step the order is: dependent indexes and constraints FIRST, then
-- the data that a narrower CHECK would reject, then the CHECK itself, and only
-- then the columns and tables. Postgres would cascade some of these
-- automatically; they are written out explicitly so the order is auditable and
-- so a reviewer can see that nothing is being dropped by accident.
--
-- TWO CROSS-MIGRATION DEPENDENCIES THIS MUST HANDLE
-- ============================================================================
-- 1. 20260927 created idx_evidence_engagement_requirement ON evidence
--    (organization_id, engagement_id, requirement_id). Those columns belong to
--    20260925. Dropping them destroys a 20260927 object, and because 20260927
--    stays recorded in schema_migrations a forward re-apply would NOT rebuild
--    it — the index would be silently lost forever. Its bookkeeping row is
--    therefore removed too. 20260927 is safely re-runnable: every statement is
--    ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, or
--    CREATE INDEX IF NOT EXISTS. Its OTHER work (vendor_engagements intake
--    columns, evidence.reviewed_at / reviewed_by_user_id / review_note) is NOT
--    touched by this rollback and survives it.
-- 2. 20261011 drops the legacy four-column unique key that this rollback
--    restores. If its bookkeeping row survived, a forward re-apply would skip
--    it, the legacy key would stay, and the 42P10 defect it exists to fix
--    (POST /api/requirement-responses, see c53d3b9d) would come straight back.
--    Its row is removed so the re-apply re-runs it.
-- 3. 20261012 restores the two evidence source types 20260925 deleted by
--    accident. This rollback re-installs the PRE-20260925 constraint, which
--    already contains them — but the forward re-apply then runs 20260925 again
--    and removes them a second time. With 20261012 still recorded it would be
--    skipped, and the database would end up back at the eleven-value list with
--    'asset_assessment' and 'finding_risk_acceptance' illegal again. Caught by
--    re-running this rehearsal after 20261012 landed: the re-forward produced
--    count=11 and asset_assessment legal? false. Its row is removed too.
--
-- DELIBERATE DEVIATION FROM A BYTE-EXACT RESTORE — RLS
-- ============================================================================
-- 20260924 ENABLEd row level security on requirement_responses, which had it
-- DISABLED before. A faithful restore would disable it again. This procedure
-- does NOT, and does not drop the tenant-isolation policy either. Rolling back
-- a feature must never widen cross-tenant visibility, and leaving RLS on is
-- strictly safer than the state it replaced. The schema comparison in the
-- rehearsal therefore expects exactly this one difference and no other.
--
-- WHAT IS LOST, STATED PLAINLY
-- ============================================================================
-- Restoring a NARROWER CHECK cannot preserve values the narrower form forbids.
-- Rows that exist only because of the rolled-back features are deleted, and any
-- surviving requirement_responses.status = 'not_applicable' is remapped to
-- 'not_assessed'. That remap is LOSSY and changes meaning: 'not_applicable' is
-- an answer ("this control does not apply"), 'not_assessed' is the absence of
-- one. Counts are raised as NOTICEs so the loss is recorded, not silent.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';

DO $$
DECLARE n bigint;
BEGIN

-- ===========================================================================
-- STEP 1 — 20260928  (findings)
-- ===========================================================================

-- 1a. Indexes that reference findings.requirement_id, before the column.
DROP INDEX IF EXISTS uq_findings_engagement_requirement;
DROP INDEX IF EXISTS idx_findings_engagement;

-- 1b. Rows the pre-migration CHECK would reject.
DELETE FROM findings WHERE source_type = 'vendor_engagement';
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'rollback: deleted % engagement-sourced findings', n;

-- 1c. Restore the pre-20260928 vocabulary (drops 'vendor_engagement').
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_source_type_check;
ALTER TABLE findings ADD CONSTRAINT findings_source_type_check CHECK (
  source_type IN ('assessment','control_test','vendor_review','vendor_cycle_review',
    'ai_review','ai_governance_review','obligation_review','dependency_review',
    'cyber_signal','signal','manual','risk','applicability_assessment',
    'asset_assessment','intelligence_event'));

-- 1d. Columns last.
ALTER TABLE findings DROP COLUMN IF EXISTS severity_rationale;
ALTER TABLE findings DROP COLUMN IF EXISTS requirement_id;

-- ===========================================================================
-- STEP 2 — 20260925  (evidence, vendor_engagement_comments)
-- ===========================================================================

-- 2a. The 20260927 index built on 20260925's columns — see header note 1.
DROP INDEX IF EXISTS idx_evidence_engagement_requirement;
DROP INDEX IF EXISTS idx_evidence_engagement;

-- 2b. CHECKs that reference the columns, before the columns.
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_engagement_source_consistent;
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_external_upload_attribution;

-- 2c. Rows the pre-migration CHECK would reject. evidence_analysis cascades.
DELETE FROM evidence WHERE source_type = 'vendor_engagement';
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'rollback: deleted % engagement-sourced evidence rows', n;

-- 2d. Restore the pre-20260925 vocabulary. NOTE: this RE-ADMITS
--     'asset_assessment' and 'finding_risk_acceptance', which 20260925 removed
--     without saying so — see the C-8 report; that removal is a separate defect.
ALTER TABLE evidence DROP CONSTRAINT IF EXISTS evidence_source_type_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_source_type_check CHECK (
  source_type IN ('control_test','vendor_review','ai_review','obligation_review',
    'ai_governance_review','dependency_review','risk_treatment','finding',
    'policy_review','risk','asset_assessment','finding_risk_acceptance'));

-- 2e. The comment thread table, then the columns (FKs drop with them).
DROP TABLE IF EXISTS vendor_engagement_comments;
ALTER TABLE evidence DROP COLUMN IF EXISTS uploaded_via_invite_id;
ALTER TABLE evidence DROP COLUMN IF EXISTS requirement_id;
ALTER TABLE evidence DROP COLUMN IF EXISTS engagement_id;

-- ===========================================================================
-- STEP 3 — 20260924  (requirement_responses, scope items, revisions)
-- ===========================================================================

-- 3a. Child table first: it FKs requirement_responses(id).
DROP TABLE IF EXISTS requirement_response_revisions;

-- 3b. Indexes over engagement_id, before the column.
DROP INDEX IF EXISTS idx_requirement_responses_unique_scoped;
DROP INDEX IF EXISTS idx_requirement_responses_engagement;

-- 3c. Engagement-scoped answers exist only because of this feature. Removing
--     them is also what makes the four-column unique key restorable in 3e:
--     duplicates across engagements are exactly what it cannot represent.
DELETE FROM requirement_responses WHERE engagement_id IS NOT NULL;
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'rollback: deleted % engagement-scoped requirement_responses', n;

UPDATE requirement_responses SET status = 'not_assessed' WHERE status = 'not_applicable';
GET DIAGNOSTICS n = ROW_COUNT;
RAISE NOTICE 'rollback: LOSSY remap of % not_applicable -> not_assessed', n;

-- 3d. Restore the pre-20260924 status vocabulary and drop the responder CHECK.
ALTER TABLE requirement_responses DROP CONSTRAINT IF EXISTS requirement_responses_responder_type_check;
ALTER TABLE requirement_responses DROP CONSTRAINT IF EXISTS requirement_responses_status_check;
ALTER TABLE requirement_responses ADD CONSTRAINT requirement_responses_status_check
  CHECK (status IN ('pass','fail','partial','not_assessed'));

-- 3e. Restore the original four-column unique key, under the name Postgres
--     generated for it (63 chars, ..._assess_key — NOT the 62-char name
--     20260924 tried and failed to drop).
ALTER TABLE requirement_responses DROP COLUMN IF EXISTS answered_via_invite_id;
ALTER TABLE requirement_responses DROP COLUMN IF EXISTS responder_type;
ALTER TABLE requirement_responses DROP COLUMN IF EXISTS engagement_id;

ALTER TABLE requirement_responses
  ADD CONSTRAINT requirement_responses_organization_id_requirement_id_assess_key
  UNIQUE (organization_id, requirement_id, assessment_type, subject_id);

-- 3f. The scope table. Nothing outside 20260924 references it.
DROP TABLE IF EXISTS vendor_engagement_scope_items;

-- 3g. RLS on requirement_responses is deliberately LEFT ENABLED, with its
--     policy intact. See the header. Do not "complete" the rollback by
--     disabling it.

END $$;

-- ===========================================================================
-- STEP 4 — bookkeeping. Removing these rows is what makes a forward re-apply
-- rebuild exactly what was removed, and nothing else.
-- ===========================================================================
DELETE FROM schema_migrations WHERE filename IN (
  '20260924_vendor_engagement_scope.sql',
  '20260925_vendor_portal_evidence_comments.sql',
  '20260927_engagement_intake_and_effectiveness.sql',
  '20260928_vendor_engagement_findings.sql',
  '20261011_requirement_responses_drop_legacy_unique.sql',
  '20261012_evidence_source_type_restore.sql'
);

COMMIT;
