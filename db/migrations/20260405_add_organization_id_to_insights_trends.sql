-- Add organization_id and category to insights, organization_id to trends.
--
-- Context:
-- The insights and trends routes query WHERE organization_id = $1 and the
-- intelligence worker inserts with organization_id, but neither column existed
-- in the original schema. All four API routes (/insights, /trends, /top-risks,
-- /top-risks/summary) returned 500 errors until this migration is applied.
--
-- Design decisions:
-- - organization_id is nullable so existing rows are preserved without an org.
-- - category is nullable on insights for the same reason.
-- - The partial unique index on insights(organization_id, signal_id) WHERE
--   organization_id IS NOT NULL supports the ON CONFLICT clause in
--   insightGenerator.ts without conflicting on legacy null-org rows.
-- - All statements use IF NOT EXISTS so this migration is safe to re-run
--   against a database that already has some of these columns or indexes.

ALTER TABLE insights
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_org_signal
  ON insights (organization_id, signal_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insights_organization_id
  ON insights (organization_id);

ALTER TABLE trends
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_trends_organization_id
  ON trends (organization_id);
