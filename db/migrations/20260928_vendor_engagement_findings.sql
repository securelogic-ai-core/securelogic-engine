-- Migration: vendor_engagement_findings
--
-- Lets a Finding point at a vendor engagement, and records the deterministic
-- reasoning behind its severity.
--
-- ── Why a NEW source_type rather than reusing 'vendor_review' ───────────────
-- `vendor_review` already exists and already means "a finding from a vendor
-- assessment". Reusing it would have been zero schema change.
--
-- It is wrong because source_type is not a label, it is a POINTER TYPE:
-- `SOURCE_TYPE_TABLE` and the Metric Contract both resolve source_id against a
-- specific table, and `vendor_review` resolves to `vendor_assessments`. A finding
-- tagged `vendor_review` whose source_id is a `vendor_engagements` row is a
-- dangling reference that every consumer would follow into the wrong table — and
-- would do so silently, because both columns are UUIDs.
--
-- Adding the value costs one CHECK and keeps one authoritative meaning per tag.
--
-- ── The uniqueness constraint is the load-bearing part ──────────────────────
-- Re-running promotion after a vendor revises an answer must UPDATE the existing
-- finding, not create a second one. Without this, a reviewer who asks for
-- clarification and re-promotes ends up with two findings for one control —
-- and closing one leaves the other open, so the vendor looks unremediated
-- forever.

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
    'applicability_assessment',
    'asset_assessment',
    'intelligence_event',
    'vendor_engagement'
  ));

-- Which control this finding came from. Nullable: findings from every other
-- source have no requirement.
ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS requirement_id UUID NULL REFERENCES requirements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS severity_rationale TEXT NULL;

COMMENT ON COLUMN findings.severity_rationale IS
  'For deterministically promoted findings: why THIS severity, in plain '
  'language, including any inherent-band lift or cap that applied. A severity a '
  'reviewer cannot interrogate is a severity they will either over-trust or '
  'ignore.';

-- One finding per (engagement, requirement). Partial, so it constrains only
-- engagement-sourced rows and leaves every other finding source untouched.
CREATE UNIQUE INDEX IF NOT EXISTS uq_findings_engagement_requirement
  ON findings (organization_id, source_id, requirement_id)
  WHERE source_type = 'vendor_engagement' AND requirement_id IS NOT NULL;

-- The reviewer's engagement view lists findings by engagement.
CREATE INDEX IF NOT EXISTS idx_findings_engagement
  ON findings (organization_id, source_id)
  WHERE source_type = 'vendor_engagement';
