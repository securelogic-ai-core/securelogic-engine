-- Migration: finding_saved_views — per-user named filter presets for the Findings
-- decision queue (ERIP §1 saved views). Additive, dark behind
-- SECURELOGIC_DECISION_WORKSPACE_ENABLED at the route layer.
--
-- A saved view is a NAMED set of Findings list filters (status/severity/source_type/
-- domain/priority) the user can re-apply. Org- AND user-scoped: a view belongs to the
-- user who created it, within their org. filters is a small JSONB object of whitelisted
-- string keys (validated at the route). No load-bearing domain data — this is a
-- preference object, not a canonical domain object.
--
-- Rollback:
--   DROP TABLE IF EXISTS finding_saved_views;

CREATE TABLE IF NOT EXISTS finding_saved_views (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  filters          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT finding_saved_views_unique UNIQUE (organization_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_finding_saved_views_lookup
  ON finding_saved_views (organization_id, user_id);

ALTER TABLE finding_saved_views ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'finding_saved_views'
       AND policyname = 'finding_saved_views_tenant_isolation'
  ) THEN
    CREATE POLICY finding_saved_views_tenant_isolation ON finding_saved_views
      USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON finding_saved_views TO app_request;
