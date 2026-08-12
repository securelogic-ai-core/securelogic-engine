-- Migration: vendor_engagements
-- Package:   Vendor Assurance — Phase 1 (engagement spine)
-- Spec:      September 15 master delivery plan; ratified methodology decisions 1-8.
--
-- THE WORKFLOW SPINE. Everything in the target model —
--   Vendor -> Engagement -> Inherent Risk -> Applicable Requirements ->
--   Questionnaire -> Evidence -> Control Effectiveness -> Findings ->
--   Actions -> Residual Risk -> Decision -> Monitoring -> Reassessment
-- hangs off this row.
--
-- ── What this table is NOT ──────────────────────────────────────────────────
--
-- Ratified constraint: "Do not turn it into a god-table or duplicate canonical
-- response/evidence/finding/action data." So this table holds LIFECYCLE,
-- RELATIONSHIPS and WORKFLOW STATE only. Questionnaire answers live in
-- requirement_responses; artifacts in evidence; findings in findings; remediation
-- in actions. Each is referenced, never copied.
--
-- ── Why a new table rather than extending vendor_reviews ────────────────────
--
-- vendor_reviews.status is an OUTCOME vocabulary (satisfactory /
-- concerns_identified / critical_issues). The engagement needs a WORKFLOW
-- vocabulary (issued / in_progress / submitted / in_review / …) and the two
-- cannot share a column. vendor_assessments and vendor_reviews become
-- read-only legacy in Phase 7; their rows and their findings stay valid and
-- visible, only their write paths retire. Three coexisting writers is how a
-- fourth gets added.
--
-- ── Scoring polarity (load-bearing — see docs/scoring-vocabulary.md) ────────
--
-- inherent_score / residual_score are INTEGER 0-100, HIGHER = WORSE, with the
-- risk-register bands (Critical >=75, High >=50, Moderate >=25, Low <25).
-- They must NEVER be copied into vendors.current_risk_score, which runs
-- HIGHER = BETTER; that inversion is recorded as deferred debt in the accepted
-- scoring-vocabulary note and blending the two is silently wrong in one
-- direction. The legacy column is frozen with its legacy formula.
--
-- ── Rating over score (the ratified override model) ─────────────────────────
--
-- *_rating is AUTHORITATIVE; *_score is a derived projection used for ordering
-- and magnitude. This is the rule already ratified for the risk register in
-- src/api/lib/riskScore.ts: an analyst-set rating may intentionally differ from
-- raw arithmetic, and scoreBand() exists to SURFACE that divergence, never to
-- override it. Both are stored so divergence stays visible forever.
--
-- ── Versioning ──────────────────────────────────────────────────────────────
--
-- methodology_version / scope_rule_version / requirement_set_version are
-- STAMPED at creation and never rewritten. Recompute reads the stamped values,
-- so revising the methodology can never retroactively move a historical rating.
--
-- Additive only: creates one table plus indexes. No existing table is altered.
-- Empty at birth — zero backfill risk. RLS lands in the Phase 2 migration
-- alongside the isolation tests that prove it (policy => routes wrapped).

CREATE TABLE IF NOT EXISTS vendor_engagements (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id                 UUID        NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

  -- ── Identity ──────────────────────────────────────────────────────────────
  engagement_type           TEXT        NOT NULL
                              CHECK (engagement_type IN ('initial', 'periodic', 'triggered', 'targeted')),
  -- A `targeted` reassessment narrows a parent engagement's scope. No FK
  -- cascade: the parent is history and must survive its child's lifecycle.
  parent_engagement_id      UUID        NULL REFERENCES vendor_engagements(id) ON DELETE SET NULL,
  title                     TEXT        NULL,

  -- ── Lifecycle (engagementStateMachine.ts is the single legality authority) ─
  status                    TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN (
                                'draft', 'scoping', 'scoped', 'issued', 'in_progress',
                                'submitted', 'in_review', 'clarification_requested',
                                'analysis_complete', 'decision_pending', 'decided',
                                'monitoring', 'closed', 'cancelled', 'expired'
                              )),
  issued_at                 TIMESTAMPTZ NULL,
  submitted_at              TIMESTAMPTZ NULL,
  closed_at                 TIMESTAMPTZ NULL,
  cancellation_reason       TEXT        NULL,

  -- ── Service context: the engagement-level declarations feeding inherent risk ─
  -- These live HERE and not on `vendors` because they describe the service and
  -- use case under assessment, not vendor master data. The same vendor can be
  -- engaged twice with different data volume, hosting or AI posture.
  data_volume_band          TEXT        NULL
                              CHECK (data_volume_band IS NULL OR data_volume_band IN
                                ('minimal', 'moderate', 'large', 'mass')),
  recoverability            TEXT        NULL
                              CHECK (recoverability IS NULL OR recoverability IN
                                ('hours', 'days', 'weeks', 'none')),
  operational_dependency    TEXT        NULL
                              CHECK (operational_dependency IS NULL OR operational_dependency IN
                                ('low', 'moderate', 'high', 'critical')),
  hosting_model             TEXT        NULL
                              CHECK (hosting_model IS NULL OR hosting_model IN
                                ('on_prem', 'private_cloud', 'saas', 'multi_tenant_saas')),
  ai_involvement            TEXT        NULL
                              CHECK (ai_involvement IS NULL OR ai_involvement IN
                                ('none', 'embedded', 'core')),
  ai_autonomy               TEXT        NULL
                              CHECK (ai_autonomy IS NULL OR ai_autonomy IN
                                ('none', 'human_in_the_loop', 'human_on_the_loop', 'autonomous_consequential')),
  fourth_party_exposure     TEXT        NULL
                              CHECK (fourth_party_exposure IS NULL OR fourth_party_exposure IN
                                ('none', 'low', 'moderate', 'high')),

  -- Ratified decision 2: the concentration input used for the FORMAL rating is
  -- snapshotted so historical assessments stay reproducible. Live concentration
  -- may be displayed separately and must be labelled as current-and-not-used.
  concentration_snapshot    TEXT        NULL
                              CHECK (concentration_snapshot IS NULL OR concentration_snapshot IN
                                ('none', 'low', 'moderate', 'single_point_of_failure')),
  concentration_snapshot_at TIMESTAMPTZ NULL,

  -- ── Inherent risk (higher = worse) ────────────────────────────────────────
  inherent_score            INTEGER     NULL CHECK (inherent_score IS NULL OR inherent_score BETWEEN 0 AND 100),
  inherent_rating           TEXT        NULL
                              CHECK (inherent_rating IS NULL OR inherent_rating IN
                                ('Critical', 'High', 'Moderate', 'Low')),
  -- The band arithmetic alone produced, before any escalation floor. Kept so the
  -- UI can show "arithmetic said Moderate; rule E1 raised it to High" rather
  -- than presenting the final band as if the weights produced it.
  inherent_arithmetic_rating TEXT       NULL
                              CHECK (inherent_arithmetic_rating IS NULL OR inherent_arithmetic_rating IN
                                ('Critical', 'High', 'Moderate', 'Low')),
  inherent_basis            JSONB       NULL,
  assessment_tier           TEXT        NULL
                              CHECK (assessment_tier IS NULL OR assessment_tier IN
                                ('tier_1_critical', 'tier_2_high', 'tier_3_moderate', 'tier_4_low')),

  -- ── Residual risk (higher = worse) ────────────────────────────────────────
  residual_score            INTEGER     NULL CHECK (residual_score IS NULL OR residual_score BETWEEN 0 AND 100),
  residual_rating           TEXT        NULL
                              CHECK (residual_rating IS NULL OR residual_rating IN
                                ('Critical', 'High', 'Moderate', 'Low')),
  residual_basis            JSONB       NULL,
  residual_computed_at      TIMESTAMPTZ NULL,

  -- ── Decision (measurement and treatment stay SEPARATE — ratified) ─────────
  -- Residual risk is what we measured; the decision is what management chose to
  -- do about it. No surface may combine them into an "adjusted" rating, and
  -- risk acceptance NEVER reduces residual_score.
  decision                  TEXT        NULL
                              CHECK (decision IS NULL OR decision IN
                                ('approved', 'approved_with_conditions', 'rejected', 'terminated')),
  decision_rationale        TEXT        NULL,
  decided_by_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  decided_at                TIMESTAMPTZ NULL,
  decision_expires_at       DATE        NULL,

  -- ── Analysis coverage (ratified: deterministic_only must never imply clean) ─
  -- 'partial' exists because the realistic failure is SOME analyzers succeeding
  -- and others dead-lettering; a binary field would mislabel that as 'full'.
  analysis_coverage         TEXT        NULL
                              CHECK (analysis_coverage IS NULL OR analysis_coverage IN
                                ('full', 'partial', 'deterministic_only')),
  analysis_coverage_at      TIMESTAMPTZ NULL,

  -- ── Continuous monitoring ─────────────────────────────────────────────────
  -- Mirrors the shipped risks cadence columns (20260607_risk_review_cadence) so
  -- the sweep job reuses that precedent verbatim instead of inventing a second
  -- cadence model.
  next_review_due           DATE        NULL,
  review_cadence_days       INTEGER     NULL CHECK (review_cadence_days IS NULL OR review_cadence_days > 0),

  -- ── Versioning: stamped at creation, NEVER rewritten ──────────────────────
  methodology_version       TEXT        NOT NULL,
  scope_rule_version        TEXT        NOT NULL,
  -- Content hash of the frameworks + requirements + scope_tags in effect for
  -- THIS org at scoping time. Per-org by nature: org A and org B legitimately
  -- have different activated frameworks.
  requirement_set_version   TEXT        NULL,

  created_by_user_id        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A decision requires its rationale and its author, together or not at all.
  -- Ratified: high-impact governance actions require rationale and audit
  -- evidence — enforced here so no code path can record a bare verdict.
  CONSTRAINT vendor_engagements_decision_consistency CHECK (
    (decision IS NULL AND decision_rationale IS NULL AND decided_at IS NULL)
    OR
    (decision IS NOT NULL AND decision_rationale IS NOT NULL
       AND length(trim(decision_rationale)) > 0 AND decided_at IS NOT NULL)
  ),

  -- An engagement cannot be its own parent.
  CONSTRAINT vendor_engagements_parent_not_self CHECK (parent_engagement_id IS NULL OR parent_engagement_id <> id),

  -- Only a targeted engagement descends from another.
  CONSTRAINT vendor_engagements_parent_requires_targeted CHECK (
    parent_engagement_id IS NULL OR engagement_type = 'targeted'
  ),

  -- Cancellation always carries a reason.
  CONSTRAINT vendor_engagements_cancellation_reason CHECK (
    status <> 'cancelled' OR (cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0)
  )
);

-- Primary list surface: the org-wide engagement queue, newest first.
CREATE INDEX IF NOT EXISTS idx_vendor_engagements_org_created
  ON vendor_engagements (organization_id, created_at DESC, id DESC);

-- Per-vendor history (the vendor detail panel).
CREATE INDEX IF NOT EXISTS idx_vendor_engagements_org_vendor
  ON vendor_engagements (organization_id, vendor_id, created_at DESC);

-- Work queues filter by status.
CREATE INDEX IF NOT EXISTS idx_vendor_engagements_org_status
  ON vendor_engagements (organization_id, status);

-- The review-due sweep: only rows actually being monitored carry a due date, so
-- a partial index keeps the daily scan proportional to the work, not the table.
CREATE INDEX IF NOT EXISTS idx_vendor_engagements_review_due
  ON vendor_engagements (organization_id, next_review_due)
  WHERE next_review_due IS NOT NULL;

-- Targeted-reassessment lineage.
CREATE INDEX IF NOT EXISTS idx_vendor_engagements_parent
  ON vendor_engagements (parent_engagement_id)
  WHERE parent_engagement_id IS NOT NULL;

-- The intelligence chain's entry point: "which engagements for this vendor are
-- currently being monitored?" — the join an external event walks to reach
-- scope items, then evidence.
CREATE INDEX IF NOT EXISTS idx_vendor_engagements_monitoring
  ON vendor_engagements (organization_id, vendor_id)
  WHERE status = 'monitoring';

COMMENT ON TABLE vendor_engagements IS
  'Vendor Assurance workflow spine: lifecycle, relationships and workflow state. '
  'Holds NO questionnaire responses, evidence, findings or actions — those live in '
  'their canonical tables and are referenced, never copied. inherent_score/'
  'residual_score are 0-100 HIGHER = WORSE (risk-register polarity); they must never '
  'be written to vendors.current_risk_score, which is inverted. *_rating is '
  'authoritative, *_score is a derived projection (see riskScore.ts).';

COMMENT ON COLUMN vendor_engagements.concentration_snapshot IS
  'Frozen at scoping so a historical rating stays reproducible when the portfolio '
  'changes. Live concentration may be shown separately, labelled as current and '
  'not used in this rating.';

COMMENT ON COLUMN vendor_engagements.analysis_coverage IS
  'full | partial | deterministic_only. deterministic_only means AI-dependent '
  'analysis did not run — it must NEVER be presented as evidence that no issues '
  'exist. Stamped when review completes; never inferred at render time.';

-- Tables created after 20260621 need an explicit grant or app_request hits
-- "permission denied" instead of being RLS-filtered. Full DML: this is a mutable
-- workflow record, not a WORM evidentiary one.
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_engagements TO app_request;
