-- Migration: finding decision_state + finding_review_marks
-- Package: ERIP Package 3 (Decision Workspace), Phase 3.2a
-- Memo: docs/architecture/erip/PACKAGE-3-DECISION-WORKSPACE-DESIGN.md (§0.6, §0.5)
--
-- Two additive changes for the Decision Workspace:
--
-- 1. findings.decision_state — the BUSINESS DECISION, kept SEPARATE from the
--    operational `status` (§0.6). Leadership owns the decision
--    (needs_review / accepted_risk / in_progress / mitigating / resolved); the
--    workflow owns `status` (open / in_progress / closed / accepted). Additive
--    NOT NULL column with a constant default (no table rewrite in PG11+),
--    backfilled from the existing status for legacy rows.
--
-- 2. finding_review_marks — per-(org, finding, user) "last reviewed" timestamp
--    powering the "What's Changed" zone (§0.5): changes since the user's own
--    previous review. ORG-scoped, RLS enabled (NOT FORCE — inert until the
--    app_request flip), app_request DML grant, registered in dataClassification.
--
-- DARK: the column/table exist but only the flag-gated Decision Workspace paths
-- read/write them; flag-off behaviour is unchanged. Additive + idempotent.
-- Reversible:
--   ALTER TABLE findings DROP COLUMN IF EXISTS decision_state;
--   DROP TABLE IF EXISTS finding_review_marks;

-- 1. Business-decision dimension ------------------------------------------------

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS decision_state TEXT NOT NULL DEFAULT 'needs_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'findings_decision_state_check'
  ) THEN
    ALTER TABLE findings
      ADD CONSTRAINT findings_decision_state_check
      CHECK (decision_state IN ('needs_review', 'accepted_risk', 'in_progress', 'mitigating', 'resolved'));
  END IF;
END $$;

-- Backfill legacy rows from the operational status (one-time, idempotent: only
-- rows still at the default are touched).
UPDATE findings SET decision_state =
  CASE
    WHEN status = 'accepted'    THEN 'accepted_risk'
    WHEN status = 'closed'      THEN 'resolved'
    WHEN status = 'in_progress' THEN 'in_progress'
    ELSE 'needs_review'
  END
WHERE decision_state = 'needs_review';

-- 2. Per-user "what's changed" review marks ------------------------------------

CREATE TABLE IF NOT EXISTS finding_review_marks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finding_id       UUID        NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT finding_review_marks_unique UNIQUE (organization_id, finding_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_finding_review_marks_lookup
  ON finding_review_marks (organization_id, finding_id, user_id);

ALTER TABLE finding_review_marks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'finding_review_marks'
       AND policyname = 'finding_review_marks_tenant_isolation'
  ) THEN
    CREATE POLICY finding_review_marks_tenant_isolation ON finding_review_marks
      USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON finding_review_marks TO app_request;
