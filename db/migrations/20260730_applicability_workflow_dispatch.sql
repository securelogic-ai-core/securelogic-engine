-- Migration: applicability_workflow_dispatch
-- Package: Enterprise Context Layer (ECL) — R2 (Slice 6 live dispatcher schema)
--
-- The S6 pure core (workflowRecommendations.ts, squash b82bd4cb) derives
-- deterministic workflow RECOMMENDATIONS (finding_draft, risk_review_recommendation,
-- evidence_request, human_review_task, notification) from a persisted applicability
-- decision, each with idempotency_key = sha256(content_hash | type | target).
-- This migration gives the live dispatcher (applicabilityWorkflowDispatcher.ts)
-- the schema it needs to APPLY those recommendations at-most-once:
--
--   1. signal_match_suggestions.assessment_id — links the human-review projection
--      (AD-8a) back to the WORM decision record (applicability_assessments) that
--      produced it. Nullable: matcher-written suggestions have no assessment.
--   2. findings.source_type += 'applicability_assessment' + a partial unique index
--      so the dispatcher's finding_draft INSERT is ON CONFLICT-idempotent
--      (one generated finding per assessment per org).
--   3. actions.source_type += 'applicability_assessment' + three partial unique
--      indexes (one per generated action_type marker) — the GAP-3 dedup pattern
--      (20260625/20260627/20260628) verbatim.
--
-- Idempotency-on-recommendation-key: the pure core's key is
-- sha256(content_hash|type|target). A content_hash maps 1:1 to one
-- applicability_assessments row (the hash embeds prev_hash; the chain makes it
-- org-unique), and every generated row below is keyed (org, assessment_id,
-- type-marker) — so the DB uniqueness here IS the durable at-most-once ledger
-- for the recommendation key; no separate dispatch table is needed.
-- Notifications reuse the alert-send ledger (keyed per user + finding), exactly
-- like the matcher's coalesced alert path.
--
-- Tenant/RLS posture (unchanged): signal_match_suggestions (20260702) and
-- findings (20260619) carry inert NULLIF org policies; `actions` has NO RLS
-- policy today (pre-existing posture — app-layer org scoping + app_request
-- grants only). This migration adds no policy and changes no grants.
--
-- Additive only. No backfill. Reversible:
--   ALTER TABLE signal_match_suggestions DROP COLUMN assessment_id;
--   DROP INDEX IF EXISTS idx_signal_match_suggestions_assessment;
--   DROP INDEX IF EXISTS idx_findings_generated_applicability;
--   DROP INDEX IF EXISTS idx_actions_generated_applicability_risk;
--   DROP INDEX IF EXISTS idx_actions_generated_applicability_evidence;
--   DROP INDEX IF EXISTS idx_actions_generated_applicability_review;
--   (+ re-run the previous CHECK-constraint definitions from
--    20260430_cyber_signals_ingestion.sql / 20260628_actions_obligation_source.sql)

-- ---------------------------------------------------------------
-- 1. signal_match_suggestions.assessment_id
--
-- FK has no ON DELETE action: applicability_assessments rows are WORM
-- (20260725 triggers block UPDATE/DELETE/TRUNCATE for every role), so the
-- referenced row can never be deleted out from under the suggestion. Org
-- purge cascades both tables via their own organization_id FKs (the WORM
-- delete-block on org purge is a pre-existing 4b property, unchanged here).
-- ---------------------------------------------------------------

ALTER TABLE signal_match_suggestions
  ADD COLUMN IF NOT EXISTS assessment_id UUID NULL REFERENCES applicability_assessments(id);

-- Reverse lookup: which suggestion(s) project a given decision record?
CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_assessment
  ON signal_match_suggestions (assessment_id)
  WHERE assessment_id IS NOT NULL;

-- ---------------------------------------------------------------
-- 2. findings: allow 'applicability_assessment' source + dedup index
--
-- Full list = 20260430_cyber_signals_ingestion.sql (the current constraint)
-- + 'applicability_assessment'. source_id carries the applicability_assessments
-- UUID when source_type = 'applicability_assessment'. No FK — consistent with
-- every other findings source type.
-- ---------------------------------------------------------------

ALTER TABLE findings
  DROP CONSTRAINT IF EXISTS findings_source_type_check;

ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
    CHECK (source_type IN (
      'assessment',
      'control_test',
      'vendor_review',
      'vendor_cycle_review',
      'ai_review',
      'ai_governance_review',
      'obligation_review',
      'dependency_review',
      'cyber_signal',
      'signal',
      'manual',
      'risk',
      'applicability_assessment'
    ));

-- One generated finding per (org, assessment). Partial on source_type: every
-- applicability-sourced finding is dispatcher-generated, so no manual-row
-- collision is possible (manual findings use source_type 'manual').
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_generated_applicability
  ON findings (organization_id, source_id)
  WHERE source_type = 'applicability_assessment';

-- ---------------------------------------------------------------
-- 3. actions: allow 'applicability_assessment' source + per-marker dedup
--
-- Full list = 20260628_actions_obligation_source.sql + 'applicability_assessment'.
-- source_id carries the applicability_assessments UUID. Three generated
-- markers, one partial unique index each (GAP-3 pattern): a user's MANUAL
-- action on the same source (different/NULL action_type) never collides.
-- ---------------------------------------------------------------

ALTER TABLE actions
  DROP CONSTRAINT IF EXISTS actions_source_type_check;

ALTER TABLE actions
  ADD CONSTRAINT actions_source_type_check
    CHECK (source_type IN (
      'assessment',
      'finding',
      'signal',
      'manual',
      'risk',
      'obligation',
      'applicability_assessment'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_generated_applicability_risk
  ON actions (organization_id, source_type, source_id)
  WHERE action_type = 'auto_applicability_risk_review';

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_generated_applicability_evidence
  ON actions (organization_id, source_type, source_id)
  WHERE action_type = 'auto_applicability_evidence_request';

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_generated_applicability_review
  ON actions (organization_id, source_type, source_id)
  WHERE action_type = 'auto_applicability_human_review';
