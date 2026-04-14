-- Migration: risk_register_primitives
-- Package: risk-register-primitives
-- Depends on: organizations table (platform-foundation)
--
-- Adds the risks table.
-- A risk is an org-scoped, mutable record capturing an identified risk:
-- its likelihood, impact, rating, treatment, and lifecycle status.
-- Optional source linkage (source_type + source_id) records where the
-- risk was identified from (finding, assessment, manual, etc.).
--
-- risk_rating is stored explicitly by the caller. Computation from
-- likelihood × impact is a future engine concern, not this package.
--
-- This migration is additive. It does not alter any existing table.

-- ---------------------------------------------------------------
-- risks
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS risks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  description      TEXT        NULL,
  domain           TEXT        NOT NULL,
  likelihood       TEXT        NOT NULL,
  impact           TEXT        NOT NULL,
  risk_rating      TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'open',
  treatment        TEXT        NULL,
  owner            TEXT        NULL,
  due_date         DATE        NULL,
  source_type      TEXT        NULL,
  source_id        UUID        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT risk_likelihood_check CHECK (
    likelihood IN ('very_likely', 'likely', 'possible', 'unlikely', 'rare')
  ),
  CONSTRAINT risk_impact_check CHECK (
    impact IN ('Critical', 'High', 'Moderate', 'Low')
  ),
  CONSTRAINT risk_rating_check CHECK (
    risk_rating IN ('Critical', 'High', 'Moderate', 'Low')
  ),
  CONSTRAINT risk_status_check CHECK (
    status IN ('open', 'accepted', 'mitigated', 'closed', 'transferred')
  ),
  CONSTRAINT risk_title_nonempty CHECK (
    length(trim(title)) > 0
  ),
  CONSTRAINT risk_source_consistency CHECK (
    (source_type IS NULL) = (source_id IS NULL)
  )
);

-- primary list access patterns
CREATE INDEX IF NOT EXISTS idx_risks_org_status
  ON risks (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_risks_org_domain
  ON risks (organization_id, domain);

CREATE INDEX IF NOT EXISTS idx_risks_org_rating
  ON risks (organization_id, risk_rating);

-- cursor pagination
CREATE INDEX IF NOT EXISTS idx_risks_org_created
  ON risks (organization_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------
-- Verification query (run after applying):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'risks'
--   ORDER BY ordinal_position;
-- ---------------------------------------------------------------
