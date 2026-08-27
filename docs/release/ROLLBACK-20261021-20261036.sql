-- ===========================================================================
-- ROLLBACK-20261021-20261036.sql
--
-- Reverses the sixteen migrations that the develop -> main promotion applies:
-- 20261021_m1_g1_app_request_grant_catchup  ..  20261036_cuec_gap_determination
--
-- WRITTEN AND REHEARSED FOR R-1 (promotion readiness pack), 2026-08-21.
-- Rehearsal record: docs/release/R1-PROMOTION-READINESS-PACK.md §D.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR
-- ---------------------------------------------------------------------------
-- This is the SCHEMA half of a code rollback. It is only ever correct to run
-- it when the engine has ALREADY been reverted to a commit whose migration set
-- ends at 20261020_erasure_actor_revalidation. Running it against the promoted
-- engine will break that engine immediately: it drops columns and tables the
-- promoted code reads unconditionally.
--
--   CORRECT ORDER:  1. revert app     2. revert workers
--                   3. revert engine  4. run this script
--
-- ---------------------------------------------------------------------------
-- THIS SCRIPT DESTROYS DATA. THAT IS NOT A SIDE EFFECT.
-- ---------------------------------------------------------------------------
-- Nine tables are dropped and nineteen columns are dropped. Everything written
-- into them between promotion and rollback is gone and is NOT recoverable from
-- this script. The pre-flight in PART 0 exists to make you see exactly how much
-- there is BEFORE you destroy it, and to refuse outright where restoring a
-- pre-promotion constraint would otherwise silently corrupt or fail.
--
-- The pre-flight is the reason to run this rather than hand-written SQL.
-- Do not comment it out. If it refuses, the refusal is the finding.
--
-- ---------------------------------------------------------------------------
-- FOUR THINGS ROLLBACK CANNOT UNDO
-- ---------------------------------------------------------------------------
-- 1. users.session_epoch is DROPPED. Every epoch counter returns to "absent".
--    On a later re-promotion each user restarts at 0, so a session token
--    minted before the rollback and carrying se=0 becomes valid again against
--    the re-promoted engine. Rolling back re-opens SEC-JWT-EPOCH (#819) and
--    a later re-promotion does NOT close it for already-minted tokens.
--    MITIGATION, MANDATORY: after any rollback, force a global credential /
--    session invalidation by the pre-#819 mechanism before re-promoting.
--
-- 2. organizations.stripe_billing_event_at / _id are DROPPED. That is the
--    SL-BILL-1 PR-D event-ordering watermark. Without it, Stripe webhooks
--    that are replayed or arrive out of order after the rollback can move
--    billing state backwards. Suspend/verify billing webhook processing
--    across the rollback window.
--
-- 3. findings.severity regains NOT NULL. Any finding ingested with an
--    unmappable source severity has severity IS NULL and CANNOT be made to
--    satisfy it without inventing a severity nobody assessed. The pre-flight
--    refuses instead of guessing. See PART 0 check 2.
--
-- 4. finding_risk_acceptances regains "one live record per finding". A finding
--    that legitimately holds BOTH a live exception and a live acceptance under
--    the promoted schema cannot satisfy it. The pre-flight refuses instead of
--    deleting one. See PART 0 check 6.
--
-- ---------------------------------------------------------------------------
-- PARTIAL PROMOTION
-- ---------------------------------------------------------------------------
-- runMigrations.ts applies each file in its OWN transaction, so a failed
-- promotion stops at a file boundary with every earlier file committed. This
-- script is written so that each PART is independently a no-op when its
-- migration never applied (IF EXISTS everywhere, and the CHECK restores are
-- idempotent). Run the whole script; it will reverse exactly what is present.
--
-- ---------------------------------------------------------------------------
-- USAGE
-- ---------------------------------------------------------------------------
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ROLLBACK-20261021-20261036.sql
--
-- PART 0 aborts the transaction on any refusal, so nothing is applied unless
-- the whole rollback is safe. Take a physical backup / PITR marker first
-- regardless: this script is not a substitute for one.
-- ===========================================================================

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';

-- ===========================================================================
-- PART 0 — PRE-FLIGHT
--
-- Reports what will be destroyed, and REFUSES where reversal is impossible
-- rather than lossy. Read the NOTICEs. They are the inventory of the loss.
-- ===========================================================================

DO $preflight$
DECLARE
  n           BIGINT;
  blockers    TEXT[] := ARRAY[]::TEXT[];
  destroyed   BIGINT := 0;
  t           TEXT;
BEGIN
  RAISE NOTICE '=== ROLLBACK 20261021..20261036 PRE-FLIGHT ===';

  -- ---- 1. findings using vocabulary that only the promoted schema allows ----
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='findings' AND column_name='source_type') THEN
    SELECT count(*) INTO n FROM findings WHERE source_type IN ('pen_test','vulnerability');
    IF n > 0 THEN
      blockers := blockers || format(
        '%s finding(s) have source_type in (pen_test, vulnerability). Restoring the pre-promotion findings_source_type_check would reject them. Reclassify or delete them first — deliberately, not by this script.', n);
    END IF;
  END IF;

  -- ---- 2. findings with no canonical severity (NOT NULL is being restored) --
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='findings' AND column_name='severity') THEN
    SELECT count(*) INTO n FROM findings WHERE severity IS NULL;
    IF n > 0 THEN
      blockers := blockers || format(
        '%s finding(s) have severity IS NULL. ALTER COLUMN severity SET NOT NULL would fail. There is no correct automatic value: assigning one manufactures an assessment nobody made. Decide per finding first.', n);
    END IF;
  END IF;

  -- ---- 3. jobs queued under the new job type ------------------------------
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='jobs' AND column_name='job_type') THEN
    SELECT count(*) INTO n FROM jobs WHERE job_type = 'control_matcher_suggest';
    IF n > 0 THEN
      blockers := blockers || format(
        '%s job(s) have job_type=control_matcher_suggest. Restoring the pre-promotion jobs_job_type_check would reject them. Drain or delete them first.', n);
    END IF;
  END IF;

  -- ---- 4. CUEC determinations that the old vocabulary cannot express -------
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='vendor_assurance_cuecs' AND column_name='review_status') THEN
    SELECT count(*) INTO n FROM vendor_assurance_cuecs
      WHERE review_status IN ('not_applicable','satisfied','gap');
    IF n > 0 THEN
      blockers := blockers || format(
        '%s CUEC(s) carry a determination (not_applicable / satisfied / gap) that the pre-promotion review_status CHECK does not allow. These are HUMAN determinations; collapsing them back to reviewed_no_match would destroy the distinction the package exists to make. Export them before proceeding.', n);
    END IF;
  END IF;

  -- ---- 5. gaps already promoted to findings -------------------------------
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='vendor_assurance_cuecs' AND column_name='promoted_finding_id') THEN
    SELECT count(*) INTO n FROM vendor_assurance_cuecs WHERE promoted_finding_id IS NOT NULL;
    IF n > 0 THEN
      RAISE NOTICE 'LOSS: % CUEC->finding promotion link(s) will be dropped with the column. The findings survive; the provenance chain back to the CUEC does not.', n;
      destroyed := destroyed + n;
    END IF;
  END IF;

  -- ---- 6. the unique index narrows: one live record per finding ------------
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='finding_risk_acceptances' AND column_name='kind') THEN
    SELECT count(*) INTO n FROM (
      SELECT finding_id FROM finding_risk_acceptances
      WHERE state IN ('proposed','approved','legacy_unverified')
      GROUP BY finding_id HAVING count(*) > 1
    ) d;
    IF n > 0 THEN
      blockers := blockers || format(
        '%s finding(s) hold MORE THAN ONE live risk-acceptance record. Recreating the pre-promotion UNIQUE INDEX finding_risk_acceptances_one_live (finding_id) WHERE state IN (proposed, approved, legacy_unverified) would fail. Withdraw one per finding first — a decision, not a cleanup.', n);
    END IF;

    SELECT count(*) INTO n FROM finding_risk_acceptances WHERE kind = 'exception';
    IF n > 0 THEN
      RAISE NOTICE 'LOSS: % risk EXCEPTION record(s) become indistinguishable from acceptances when `kind` is dropped. Under the pre-promotion contract an acceptance CLOSES its finding, so these findings will read as closed after rollback even though remediation is still outstanding. Export them first.', n;
      destroyed := destroyed + n;
    END IF;
  END IF;

  -- ---- 7. tables that will be dropped outright ----------------------------
  FOREACH t IN ARRAY ARRAY[
    'llm_control_matcher_verdicts','billing_dunning_cycles','finding_risks',
    'pen_test_engagements','asset_identifiers','finding_asset_occurrences',
    'vulnerability_scan_runs','vulnerability_scan_run_assets','vulnerability_observations'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n > 0 THEN
        RAISE NOTICE 'LOSS: table % holds % row(s), all destroyed by DROP TABLE.', t, n;
        destroyed := destroyed + n;
      END IF;
    END IF;
  END LOOP;

  -- ---- 8. security / billing state that rollback cannot restore -----------
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='users' AND column_name='session_epoch') THEN
    SELECT count(*) INTO n FROM users WHERE session_epoch > 0;
    IF n > 0 THEN
      RAISE NOTICE 'SECURITY: % user(s) have an advanced session_epoch. Dropping the column returns every counter to absent; on re-promotion they restart at 0 and previously-invalidated tokens carrying se=0 become valid again. A global session invalidation by the pre-#819 mechanism is MANDATORY after this rollback.', n;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='organizations' AND column_name='stripe_billing_event_id') THEN
    SELECT count(*) INTO n FROM organizations WHERE stripe_billing_event_id IS NOT NULL;
    IF n > 0 THEN
      RAISE NOTICE 'BILLING: % organization(s) carry a Stripe event-ordering watermark that is destroyed here. Out-of-order or replayed webhooks can move billing state backwards after rollback. Suspend webhook processing across the window.', n;
    END IF;
  END IF;

  -- ---- verdict -----------------------------------------------------------
  IF array_length(blockers,1) IS NOT NULL THEN
    RAISE EXCEPTION E'ROLLBACK REFUSED — % blocker(s). Nothing has been changed.\n\n  * %\n\nEach blocker is data that exists only because the promoted schema allowed it. Reversing it is a product decision, not a migration step.',
      array_length(blockers,1), array_to_string(blockers, E'\n\n  * ');
  END IF;

  RAISE NOTICE 'PRE-FLIGHT PASSED. % row(s) will be destroyed. Proceeding.', destroyed;
END
$preflight$;

-- ===========================================================================
-- PART 1 — REVERSE DDL, strict reverse filename order (20261036 -> 20261021)
-- ===========================================================================

-- ---- 20261036_cuec_gap_determination -------------------------------------
DROP INDEX IF EXISTS idx_cuecs_unpromoted_gaps;
DROP INDEX IF EXISTS idx_cuecs_org_review_status;

ALTER TABLE vendor_assurance_cuecs
  DROP CONSTRAINT IF EXISTS vendor_assurance_cuecs_promotion_requires_gap;

ALTER TABLE vendor_assurance_cuecs
  DROP CONSTRAINT IF EXISTS vendor_assurance_cuecs_review_status_consistency;
ALTER TABLE vendor_assurance_cuecs
  ADD CONSTRAINT vendor_assurance_cuecs_review_status_consistency CHECK (
    (review_status = 'pending'
      AND review_status_updated_at IS NULL
      AND review_status_updated_by_user_id IS NULL
      AND review_status_reason IS NULL)
    OR
    (review_status = 'reviewed_no_match'
      AND review_status_updated_at IS NOT NULL)
  );

ALTER TABLE vendor_assurance_cuecs
  DROP CONSTRAINT IF EXISTS vendor_assurance_cuecs_review_status_check;
ALTER TABLE vendor_assurance_cuecs
  ADD CONSTRAINT vendor_assurance_cuecs_review_status_check
  CHECK (review_status IN ('pending', 'reviewed_no_match'));

ALTER TABLE vendor_assurance_cuecs
  DROP COLUMN IF EXISTS promoted_finding_id,
  DROP COLUMN IF EXISTS gap_basis;

-- The column comment is not cosmetic here: left in place it documents four
-- determination states that the CHECK restored above now REJECTS, so the
-- schema would describe a vocabulary it refuses to store. Comments on columns
-- this rollback DROPS need no such treatment — they go with the column.
COMMENT ON COLUMN vendor_assurance_cuecs.review_status IS NULL;

-- ---- 20261035_vulnerability_observations ---------------------------------
DROP TABLE IF EXISTS vulnerability_observations;
DROP TABLE IF EXISTS vulnerability_scan_run_assets;
DROP TABLE IF EXISTS vulnerability_scan_runs;

-- ---- 20261034_finding_asset_occurrences ----------------------------------
DROP TABLE IF EXISTS finding_asset_occurrences;

-- ---- 20261033_asset_identifiers ------------------------------------------
DROP TABLE IF EXISTS asset_identifiers;

-- ---- 20261032_vulnerability_findings -------------------------------------
DROP INDEX IF EXISTS idx_findings_org_cve;
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_seen_window;
ALTER TABLE findings
  DROP COLUMN IF EXISTS cve_id,
  DROP COLUMN IF EXISTS cwe_id,
  DROP COLUMN IF EXISTS cvss_version,
  DROP COLUMN IF EXISTS first_seen_at,
  DROP COLUMN IF EXISTS last_seen_at;

-- source_type returns to the 20261030 vocabulary (pen_test, no vulnerability);
-- the 20261030 section below takes it the rest of the way. Stated in two steps
-- on purpose, so a partial rollback that stops here lands on a real state.
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_source_type_check;
ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
  CHECK (source_type IN (
    'assessment','control_test','vendor_review','vendor_cycle_review',
    'ai_review','ai_governance_review','obligation_review','dependency_review',
    'cyber_signal','signal','manual','risk','applicability_assessment',
    'asset_assessment','intelligence_event','vendor_engagement','pen_test'
  ));

-- ---- 20261031_finding_risk_exceptions ------------------------------------
DROP INDEX IF EXISTS finding_risk_acceptances_kind_expiry;
DROP INDEX IF EXISTS finding_risk_acceptances_one_live_per_kind;
CREATE UNIQUE INDEX IF NOT EXISTS finding_risk_acceptances_one_live
  ON finding_risk_acceptances (finding_id)
  WHERE state IN ('proposed', 'approved', 'legacy_unverified');

-- The WORM trigger function is restored to its pre-promotion body BEFORE the
-- column it references is dropped. Reversed, the trigger fires against a
-- column that no longer exists and every UPDATE on the table fails.
CREATE OR REPLACE FUNCTION public.finding_risk_acceptances_enforce_worm()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Immutable subject, always.
  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.finding_id <> OLD.finding_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'finding_risk_acceptances: id/organization_id/finding_id/created_at are immutable';
  END IF;

  -- Decision content freezes the moment the record stops being a proposal.
  IF OLD.state <> 'proposed' THEN
    IF NEW.owner_user_id        IS DISTINCT FROM OLD.owner_user_id
       OR NEW.rationale            IS DISTINCT FROM OLD.rationale
       OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
       OR NEW.approver_user_id     IS DISTINCT FROM OLD.approver_user_id
       OR NEW.approved_at          IS DISTINCT FROM OLD.approved_at
       OR NEW.decision_rationale   IS DISTINCT FROM OLD.decision_rationale
       OR NEW.expires_at           IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION
        'finding_risk_acceptances: the decision content of a % acceptance is immutable (WORM). Withdraw it and propose a new acceptance.',
        OLD.state;
    END IF;
  END IF;

  -- Legal state transitions only. Terminal states are terminal.
  IF NEW.state <> OLD.state THEN
    IF NOT (
      (OLD.state = 'proposed'          AND NEW.state IN ('approved', 'rejected', 'withdrawn'))
      OR (OLD.state = 'approved'          AND NEW.state IN ('expired', 'withdrawn'))
      OR (OLD.state = 'legacy_unverified' AND NEW.state IN ('approved', 'withdrawn'))
    ) THEN
      RAISE EXCEPTION 'finding_risk_acceptances: illegal state transition % → %', OLD.state, NEW.state;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

ALTER TABLE finding_risk_acceptances
  DROP CONSTRAINT IF EXISTS finding_risk_acceptance_kind_check;
ALTER TABLE finding_risk_acceptances
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS compensating_control,
  DROP COLUMN IF EXISTS sla_due_date_at_request;

-- ---- 20261030_pen_test_findings ------------------------------------------
DROP TABLE IF EXISTS pen_test_engagements;

ALTER TABLE findings
  DROP COLUMN IF EXISTS source_severity,
  DROP COLUMN IF EXISTS source_reference_id,
  DROP COLUMN IF EXISTS cvss_score,
  DROP COLUMN IF EXISTS cvss_vector;

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_source_type_check;
ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
  CHECK (source_type IN (
    'assessment','control_test','vendor_review','vendor_cycle_review',
    'ai_review','ai_governance_review','obligation_review','dependency_review',
    'cyber_signal','signal','manual','risk','applicability_assessment',
    'asset_assessment','intelligence_event','vendor_engagement'
  ));

-- Guarded by PART 0 check 2: this fails loudly if any severity IS NULL.
ALTER TABLE findings ALTER COLUMN severity SET NOT NULL;

COMMENT ON COLUMN findings.severity IS NULL;

-- ---- 20261029_finding_risk_links -----------------------------------------
DROP TABLE IF EXISTS finding_risks;

-- ---- 20261028_billing_dunning_cycles -------------------------------------
DROP TABLE IF EXISTS billing_dunning_cycles;

-- ---- 20261027_organizations_stripe_event_watermark -----------------------
ALTER TABLE organizations
  DROP COLUMN IF EXISTS stripe_billing_event_at,
  DROP COLUMN IF EXISTS stripe_billing_event_id;

-- ---- 20261026_users_session_epoch ----------------------------------------
ALTER TABLE users DROP COLUMN IF EXISTS session_epoch;

-- ---- 20261025_signal_match_suggestion_surfaced ---------------------------
DROP INDEX IF EXISTS idx_signal_match_suggestions_first_surfaced;
ALTER TABLE signal_match_suggestions
  DROP COLUMN IF EXISTS first_surfaced_at,
  DROP COLUMN IF EXISTS last_surfaced_at,
  DROP COLUMN IF EXISTS surface_count,
  DROP COLUMN IF EXISTS last_surfaced_surface;

-- ---- 20261024_jobs_control_matcher_suggest -------------------------------
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_type_check
    CHECK (job_type IN (
      'data_export_self','data_export_org','account_deletion_reap',
      'export_file_purge','vendor_assurance_extract','applicability_reassess',
      'connector_sync','vendor_evidence_analysis','ask_provenance','retention_sweep'
    ));

-- ---- 20261023_llm_control_matcher_verdicts -------------------------------
DROP TABLE IF EXISTS llm_control_matcher_verdicts;

-- ---- 20261022_m1_g2_sso_login_codes_export_read --------------------------
REVOKE SELECT ON sso_login_codes FROM app_request;

-- ---- 20261021_m1_g1_app_request_grant_catchup ----------------------------
REVOKE SELECT, INSERT, UPDATE ON asset_assessments, risk_approvals FROM app_request;
REVOKE SELECT, INSERT ON
  evidence_analysis, intelligence_brief_item_provenance, risk_lifecycle_events
  FROM app_request;
REVOKE SELECT ON
  canonical_products, canonical_product_versions, canonical_product_external_ids,
  intelligence_events, intelligence_event_sources, legal_consents
  FROM app_request;

-- ===========================================================================
-- PART 2 — the ledger
--
-- Removed LAST, and inside the same transaction, so schema_migrations can
-- never claim a migration is applied whose DDL has been reversed. A later
-- re-promotion re-applies all sixteen from a clean slate.
-- ===========================================================================

DELETE FROM schema_migrations WHERE filename IN (
  '20261021_m1_g1_app_request_grant_catchup.sql',
  '20261022_m1_g2_sso_login_codes_export_read.sql',
  '20261023_llm_control_matcher_verdicts.sql',
  '20261024_jobs_control_matcher_suggest.sql',
  '20261025_signal_match_suggestion_surfaced.sql',
  '20261026_users_session_epoch.sql',
  '20261027_organizations_stripe_event_watermark.sql',
  '20261028_billing_dunning_cycles.sql',
  '20261029_finding_risk_links.sql',
  '20261030_pen_test_findings.sql',
  '20261031_finding_risk_exceptions.sql',
  '20261032_vulnerability_findings.sql',
  '20261033_asset_identifiers.sql',
  '20261034_finding_asset_occurrences.sql',
  '20261035_vulnerability_observations.sql',
  '20261036_cuec_gap_determination.sql'
);

DO $verify$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM schema_migrations;
  IF n <> 232 THEN
    RAISE EXCEPTION 'schema_migrations holds % rows after rollback, expected 232. Refusing to commit.', n;
  END IF;
  RAISE NOTICE 'ROLLBACK COMPLETE. schema_migrations = 232.';
END
$verify$;

COMMIT;
