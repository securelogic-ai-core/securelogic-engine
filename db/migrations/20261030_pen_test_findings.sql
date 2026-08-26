-- 20261030_pen_test_findings.sql
--
-- Penetration-test findings intake (SL-PENTEST-IN).
--
-- Pen-test results were the one finding source with no home. The product
-- DESCRIBES penetration testing in five framework templates (SOC 2 CC7.1,
-- ISO A.8.29, PCI-11, CIS-16, CIS-18) and had nowhere to put its output, so a
-- customer's most expensive annual security exercise arrived as a PDF and left
-- as `source_type='manual'` with the engagement, the tester and the report
-- reference all lost.
--
-- Nothing here is a parallel lifecycle. A pen-test finding is a Finding: same
-- table, same two-axis state machine, same SLA, same Risk Register
-- relationship, same evidence, same closure gates.
--
-- ── 1. `pen_test` as a source type ─────────────────────────────────────────
-- source_type is a POINTER TYPE, not a label — source_id resolves against a
-- specific table per value. `pen_test` resolves to pen_test_engagements below.
--
-- ── 2. THE SEVERITY DECISION, which is the substance of this migration ─────
-- External severity vocabularies do not agree with ours, and one of the
-- disagreements is not a naming difference: **Informational means there is no
-- material vulnerability severity at all.**
--
-- Coercing Informational to 'Low' would be the worst available outcome. Low is
-- SLA-BEARING: under a configured policy it acquires a due date, enters the
-- overdue population, and appears on an executive report as unremediated work.
-- The platform would have manufactured a remediation obligation the tester
-- never asserted and the customer never accepted.
--
-- So severity becomes NULLABLE, and NULL means exactly one thing: THIS FINDING
-- HAS NO CANONICAL SEVERITY. It is not "unknown pending triage" and not a
-- hidden fifth level.
--
-- Nullable rather than a fifth enum value, deliberately: a new canonical
-- severity would have to be understood by every ranking, filter, badge,
-- export, brief and dashboard that enumerates the four — and each one that
-- forgot it would fail SILENTLY, ordering it last or dropping it. NULL fails
-- LOUDLY and correctly instead: slaDaysFor() already returns null for a
-- severity it does not recognise, so no due date is computed and no SLA is
-- manufactured, with no change to the SLA engine at all. The rank expressions
-- in findings.ts already terminate in `ELSE 5`.
--
-- The invariant that keeps NULL honest is enforced in findingValidation.ts,
-- not here: a finding may omit the canonical severity ONLY if it supplies
-- source_severity. "No canonical severity" must always be accompanied by the
-- verbatim value that could not be mapped, or it is just missing data.
--
-- Existing rows are unaffected: every one has a severity, and dropping NOT NULL
-- neither rewrites nor revalidates them.

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_source_type_check;

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
    'applicability_assessment',
    'asset_assessment',
    'intelligence_event',
    'vendor_engagement',
    'pen_test'
  ));

ALTER TABLE findings ALTER COLUMN severity DROP NOT NULL;

COMMENT ON COLUMN findings.severity IS
  'Canonical, SLA-BEARING severity: Critical | High | Moderate | Low. NULL means the finding has NO canonical severity — the source said Informational/None, or its value could not be mapped confidently. NULL is never a hidden fifth level and never acquires a due date: slaDaysFor() returns null for it. A NULL severity is only legal alongside source_severity.';

-- ── 3. What the source actually said ───────────────────────────────────────
-- Kept verbatim and separately, so normalisation is auditable rather than
-- destructive: a reader can always see what the tester wrote AND what we
-- concluded, and can re-run the mapping to check us.

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS source_severity     TEXT,
  ADD COLUMN IF NOT EXISTS source_reference_id TEXT,
  ADD COLUMN IF NOT EXISTS cvss_score          NUMERIC(4,1)
    CHECK (cvss_score IS NULL OR (cvss_score >= 0 AND cvss_score <= 10)),
  ADD COLUMN IF NOT EXISTS cvss_vector         TEXT;

COMMENT ON COLUMN findings.source_severity IS
  'The severity the SOURCE stated, verbatim (e.g. "Medium", "Informational", "P2", "9.1"). Never normalised, never overwritten. Required whenever severity IS NULL.';
COMMENT ON COLUMN findings.source_reference_id IS
  'The finding''s id in the source report (e.g. "PT-2026-014"), so a customer can match our record to the PDF on their desk.';

-- ── 4. The engagement ──────────────────────────────────────────────────────
-- A table, not columns on findings: name, provider and dates are properties of
-- the TEST, shared by every finding it produced. Repeating them per row would
-- let one report disagree with itself.
--
-- Deliberately small. A pen-test report has dozens of fields; this holds only
-- what is needed to answer "which test produced this, run by whom, when, and
-- where is the report" — the questions an auditor actually asks.

CREATE TABLE IF NOT EXISTS pen_test_engagements (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name               TEXT        NOT NULL,
  -- The testing firm. Free text on purpose: this is not a Vendor record, and
  -- forcing it to be one would make recording a test require onboarding its
  -- supplier into third-party risk first.
  provider           TEXT,
  started_on         DATE,
  ended_on           DATE,
  -- Where the report lives — a URL, a document id, or a filing reference.
  report_reference   TEXT,

  created_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pen_test_engagement_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT pen_test_engagement_period CHECK (
    started_on IS NULL OR ended_on IS NULL OR ended_on >= started_on
  )
);

CREATE INDEX IF NOT EXISTS idx_pen_test_engagements_org
  ON pen_test_engagements (organization_id, started_on DESC NULLS LAST);

ALTER TABLE pen_test_engagements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pen_test_engagements_tenant_isolation ON pen_test_engagements;
CREATE POLICY pen_test_engagements_tenant_isolation ON pen_test_engagements
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- No DELETE: an engagement with findings hanging off it is the provenance of
-- those findings, and deleting it would orphan them silently.
GRANT SELECT, INSERT, UPDATE ON pen_test_engagements TO app_request;

COMMENT ON TABLE pen_test_engagements IS
  'One penetration test. findings.source_type=''pen_test'' with source_id pointing here. Holds only the provenance an auditor asks for — which test, by whom, when, and where the report is — not a reproduction of the report.';
