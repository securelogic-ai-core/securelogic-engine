-- Migration: ai_use_approvals
-- Package:   AI Governance T2-D2 — the formal use decision.
--
-- The gap this closes: the platform can ASSESS an AI system
-- (ai_governance_assessments) and REVIEW it point-in-time (governance_reviews),
-- but it cannot record the decision those activities exist to inform — "this
-- organisation approves this AI system for use, on these grounds, by this
-- person, until this date." An AI-governance product that cannot produce the
-- approval record is an inventory with opinions. EU AI Act and NIST AI RMF
-- (GOVERN) reviewers ask for exactly this artifact.
--
-- ── THE MODEL IS THE VENDOR DECISION, DELIBERATELY ──────────────────────────
-- vendor_engagements already ratified the decision shape: a closed decision
-- vocabulary, a DB-enforced rationale, an approver FK, an expiry date, and the
-- measurement the decision was made AGAINST captured at decision time. This
-- table is that shape re-anchored on ai_systems, with two deliberate
-- differences:
--
--   1. APPEND-ONLY, one row per decision act. The vendor decision lives in
--      mutable columns on the engagement because an engagement IS one
--      assessment cycle. An AI system is a durable object that gets decided
--      about repeatedly (approve → conditions → suspend → re-approve), and
--      "what was decided, when, by whom, in what order" is the audit question.
--      The CURRENT decision is simply the latest row (decided_at DESC, id
--      DESC); prior rows are history, never rewritten. There is no UPDATE
--      grant and no updated_at — a wrong decision is superseded by a new row,
--      not edited.
--
--   2. 'suspended' exists in the vocabulary. A vendor engagement that goes bad
--      is re-engaged; an AI system in production that goes bad is SUSPENDED,
--      and that act needs to be expressible without pretending it was a
--      rejection that somehow post-dates an approval.
--
-- ── WHAT THE DECISION WAS MADE AGAINST ──────────────────────────────────────
-- `assessment_id` points at the ai_governance_assessments row that informed
-- the decision (nullable: a rejection can be recorded with no assessment — "we
-- looked at the proposal and said no" is a real decision). ON DELETE SET NULL:
-- the decision record outlives its assessment.
--
-- `material_state_version` snapshots ai_systems.material_state_version at
-- decision time. When the system's version has moved past the approval's,
-- "approved, but materially changed since" becomes a queryable fact — the
-- read routes surface it, and it is the deterministic trigger T2-D's
-- reassessment recommendation keys off.
--
-- ── Consistency rules, enforced by shape ────────────────────────────────────
--   * rationale is NOT NULL and non-blank for EVERY decision — approving
--     without grounds is as unauditable as rejecting without grounds.
--   * expires_at only makes sense on the approving decisions; a rejection or
--     suspension does not expire, it stands until superseded.
--
-- RLS + grants at creation. INSERT and SELECT only — see difference 1.

CREATE TABLE IF NOT EXISTS ai_use_approvals (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- RESTRICT: an AI system with a decision history is not silently deletable;
  -- the history is the point.
  ai_system_id           UUID        NOT NULL REFERENCES ai_systems(id) ON DELETE RESTRICT,

  decision               TEXT        NOT NULL CHECK (decision IN
                           ('approved', 'approved_with_conditions', 'rejected', 'suspended')),
  rationale              TEXT        NOT NULL,
  -- The conditions of an approved_with_conditions decision, as text the
  -- approver wrote. Structured per-condition tracking (each condition a row
  -- with an owner and a due date) is a recorded follow-up — the honest v1 is
  -- the approver's words, required exactly when conditions are claimed.
  conditions             TEXT        NULL,

  decided_by_user_id     UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  decided_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at             DATE        NULL,

  assessment_id          UUID        NULL REFERENCES ai_governance_assessments(id) ON DELETE SET NULL,
  material_state_version INTEGER     NOT NULL,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_use_approvals_rationale_nonblank CHECK (length(trim(rationale)) > 0),
  CONSTRAINT ai_use_approvals_conditions_iff_conditional CHECK (
    (decision = 'approved_with_conditions' AND conditions IS NOT NULL AND length(trim(conditions)) > 0)
    OR (decision <> 'approved_with_conditions' AND conditions IS NULL)
  ),
  CONSTRAINT ai_use_approvals_expiry_only_on_approval CHECK (
    expires_at IS NULL OR decision IN ('approved', 'approved_with_conditions')
  )
);

-- The one query that matters: "current decision for this system" — latest row.
CREATE INDEX IF NOT EXISTS idx_ai_use_approvals_system_latest
  ON ai_use_approvals (organization_id, ai_system_id, decided_at DESC, id DESC);

-- The reporting query: "approvals expiring soon", org-wide. Partial — only
-- approving rows carry an expiry at all.
CREATE INDEX IF NOT EXISTS idx_ai_use_approvals_expiring
  ON ai_use_approvals (organization_id, expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE ai_use_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_use_approvals_tenant_isolation ON ai_use_approvals
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- No UPDATE, no DELETE: append-only by grant, not just by convention.
GRANT SELECT, INSERT ON ai_use_approvals TO app_request;

COMMENT ON TABLE ai_use_approvals IS
  'Append-only formal use decisions for AI systems (T2-D2). The current decision '
  'is the latest row per system; prior rows are immutable history. Modeled on the '
  'ratified vendor_engagements decision block; see the migration header for the '
  'two deliberate differences (append-only; suspended).';
