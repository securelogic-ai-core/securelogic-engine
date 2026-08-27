-- Migration: pen_test_finding_retests
-- Package:   T2-I (pen-test completion) — 2 of 2: the retest record.
--
-- "Fixed, per the retest of <date>, by <the tester>" is the artifact a
-- customer's auditor asks for, and the platform could not say it: a pen-test
-- finding could be remediated and closed, but the VERIFICATION event — the
-- tester looked again, and here is what they found — had nowhere to live.
--
-- ── APPEND-ONLY, one row per retest act ─────────────────────────────────────
-- The same shape as ai_use_approvals and for the same reason: "what did the
-- retest find, when, in what order" is the audit question, and an editable
-- latest-state column cannot answer it. A finding may be retested many times
-- (failed retest -> more remediation -> retest again); every act is a row;
-- the current verification state is the latest row. No UPDATE, no DELETE —
-- by grant, not convention.
--
-- ── A RETEST RESULT NEVER CLOSES THE FINDING ────────────────────────────────
-- The platform's closure gate (SoD, evidence requirement, decision_state) is
-- the ONLY closure path, and a 'remediated' retest is INPUT to that human
-- decision, not a substitute for it. This is the same ruling, third
-- appearance: scanner reappearance never reopens, monitoring recommendation
-- never transitions, retest result never closes. Machines observe; humans
-- decide. The route writes the retest and touches the finding not at all.
--
-- ── Anchored on the FINDING, carrying the engagement ────────────────────────
-- finding_id is the subject (the exposure being verified). engagement_id
-- records WHICH engagement's retest this was — usually the same engagement
-- that produced the finding, but a NEXT engagement legitimately retests a
-- prior engagement's findings (the annual test verifying last year's fixes),
-- so the column is a real FK, not derivable from the finding.

CREATE TABLE IF NOT EXISTS pen_test_finding_retests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- RESTRICT: a finding with a verification history is not silently deletable.
  finding_id           UUID        NOT NULL REFERENCES findings(id) ON DELETE RESTRICT,
  engagement_id        UUID        NOT NULL REFERENCES pen_test_engagements(id) ON DELETE RESTRICT,

  result               TEXT        NOT NULL CHECK (result IN
                         ('remediated', 'not_remediated', 'partially_remediated')),
  -- The tester's words. Required for the two results that keep work open —
  -- "not fixed" with no detail sends the remediation owner back to the report.
  notes                TEXT        NULL,
  performed_on         DATE        NOT NULL DEFAULT CURRENT_DATE,

  recorded_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pen_test_retest_notes_when_open CHECK (
    result = 'remediated' OR (notes IS NOT NULL AND length(trim(notes)) > 0)
  )
);

-- "Verification history for this finding", newest first — the reading order.
CREATE INDEX IF NOT EXISTS idx_pen_test_retests_finding
  ON pen_test_finding_retests (organization_id, finding_id, performed_on DESC, id DESC);

-- "Everything this engagement retested" — the engagement detail's list.
CREATE INDEX IF NOT EXISTS idx_pen_test_retests_engagement
  ON pen_test_finding_retests (organization_id, engagement_id);

ALTER TABLE pen_test_finding_retests ENABLE ROW LEVEL SECURITY;
CREATE POLICY pen_test_finding_retests_tenant_isolation ON pen_test_finding_retests
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Append-only by grant (see header).
GRANT SELECT, INSERT ON pen_test_finding_retests TO app_request;
