-- Platform Primitive Foundation
--
-- Establishes three missing platform primitives:
--   1. findings — expanded from assessment-scoped to platform-scoped
--   2. actions  — new first-class remediation tracking object
--   3. posture_snapshots + domain_scores — org-level posture record
--
-- Findings expansion is additive and backward compatible:
--   - assessment_id becomes nullable (existing rows keep their values)
--   - organization_id is backfilled from parent assessment rows
--   - source_type defaults to 'assessment' for all existing rows
--   - new columns are nullable so existing inserts do not break before
--     the application layer is updated

-- ============================================================
-- 1. FINDINGS — expand to platform scope
-- ============================================================

-- Make assessment_id nullable so findings can come from non-assessment sources
ALTER TABLE findings
  ALTER COLUMN assessment_id DROP NOT NULL;

-- Add organization_id (populated via backfill below before NOT NULL is set)
ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Add source classification with a safe default for existing rows
ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'assessment';

-- Add remaining platform fields — all nullable; populated by source-specific workflows
ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS source_id       UUID,
  ADD COLUMN IF NOT EXISTS domain          TEXT,
  ADD COLUMN IF NOT EXISTS priority        TEXT,
  ADD COLUMN IF NOT EXISTS likelihood      TEXT,
  ADD COLUMN IF NOT EXISTS confidence      TEXT,
  ADD COLUMN IF NOT EXISTS time_sensitivity TEXT,
  ADD COLUMN IF NOT EXISTS scoring_rationale TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill organization_id from parent assessment rows
UPDATE findings f
  SET organization_id = a.organization_id
  FROM assessments a
  WHERE f.assessment_id = a.id
    AND f.organization_id IS NULL;

-- Enforce NOT NULL now that backfill is complete
ALTER TABLE findings
  ALTER COLUMN organization_id SET NOT NULL;

-- Check constraints — applied after backfill to avoid constraint violations on existing data
ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
    CHECK (source_type IN ('assessment', 'control_test', 'vendor_review', 'ai_review', 'signal', 'manual')),
  ADD CONSTRAINT findings_priority_check
    CHECK (priority IS NULL OR priority IN ('immediate', 'near_term', 'planned', 'watch')),
  ADD CONSTRAINT findings_likelihood_check
    CHECK (likelihood IS NULL OR likelihood IN ('very_high', 'high', 'medium', 'low', 'very_low')),
  ADD CONSTRAINT findings_confidence_check
    CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low', 'unverified')),
  ADD CONSTRAINT findings_time_sensitivity_check
    CHECK (time_sensitivity IS NULL OR time_sensitivity IN ('immediate', 'near_term', 'planned', 'watch'));

-- Indexes for platform-level queries
CREATE INDEX IF NOT EXISTS idx_findings_org_status   ON findings (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_findings_org_source   ON findings (organization_id, source_type);
CREATE INDEX IF NOT EXISTS idx_findings_org_priority ON findings (organization_id, priority);
CREATE INDEX IF NOT EXISTS idx_findings_org_domain   ON findings (organization_id, domain);

-- ============================================================
-- 2. ACTIONS — new platform primitive
-- ============================================================

CREATE TABLE IF NOT EXISTS actions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  action_type     TEXT,
  source_type     TEXT        NOT NULL
                  CHECK (source_type IN ('assessment', 'finding', 'signal', 'manual')),
  source_id       UUID,
  priority        TEXT        NOT NULL
                  CHECK (priority IN ('immediate', 'near_term', 'planned', 'watch')),
  due_date        DATE,
  owner_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'blocked', 'closed', 'accepted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_actions_org_status   ON actions (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_actions_org_priority ON actions (organization_id, priority);
CREATE INDEX IF NOT EXISTS idx_actions_org_due      ON actions (organization_id, due_date);
CREATE INDEX IF NOT EXISTS idx_actions_owner        ON actions (owner_user_id);

-- ============================================================
-- 3. POSTURE SNAPSHOTS + DOMAIN SCORES
-- ============================================================

CREATE TABLE IF NOT EXISTS posture_snapshots (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date        DATE    NOT NULL,
  overall_score        INTEGER CHECK (overall_score BETWEEN 0 AND 100),
  overall_severity     TEXT,
  open_finding_count   INTEGER NOT NULL DEFAULT 0,
  open_action_count    INTEGER NOT NULL DEFAULT 0,
  overdue_action_count INTEGER NOT NULL DEFAULT 0,
  computation_rationale JSONB  NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS domain_scores (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  posture_snapshot_id UUID    NOT NULL REFERENCES posture_snapshots(id) ON DELETE CASCADE,
  domain              TEXT    NOT NULL,
  score               INTEGER CHECK (score BETWEEN 0 AND 100),
  severity            TEXT,
  trend_direction     TEXT    CHECK (trend_direction IN ('improving', 'stable', 'worsening', 'unknown')),
  finding_count       INTEGER NOT NULL DEFAULT 0,
  action_count        INTEGER NOT NULL DEFAULT 0,
  rationale           TEXT,
  UNIQUE (posture_snapshot_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_posture_snapshots_org  ON posture_snapshots (organization_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_domain_scores_snapshot ON domain_scores (posture_snapshot_id);
