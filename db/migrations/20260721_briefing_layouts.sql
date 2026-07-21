-- Migration: briefing_layouts — per-user Briefing layout persistence (Briefing
-- Initiative B2: Role-Aware Defaults & Personalization). Additive, dark behind
-- SECURELOGIC_DASHBOARD_BRIEFING_ENABLED at the route layer (engine half of the
-- two-switch model; the app half shipped in B1).
--
-- One ACTIVE layout per (organization, user) — the B2 "exactly one personalized
-- Briefing" ruling (docs/specs/briefing-initiative-b2-spec.md). layout holds ONLY
-- the ratified instance-shaped versioned envelope
--   {"version": 1, "modules": [{"moduleId", "instanceKey", "config"}]}
-- validated at the route against the GENERATED engine module manifest
-- (src/api/lib/briefingModuleManifest.generated.ts) — never the client catalog.
-- B3 (profiles) upgrades this table in place: add name + an active pointer, DROP
-- CONSTRAINT briefing_layouts_one_per_user (named here so that drop is
-- deterministic; B3 must then add a replacement (organization_id, user_id)
-- lookup index and rewrite the ON CONFLICT upsert). Rows written here survive
-- as the active profile.
--
-- user_id is NOT NULL PERMANENTLY: B4 organizational Briefings are a separate
-- template table per the contracts.ts object-model boundary #4 — never
-- user_id-IS-NULL dual-purpose rows (the dashboard_preferences org_default
-- pattern is explicitly rejected for this table).
--
-- GDPR: the users-row CASCADE never fires in practice (erasure tombstones the
-- users row); accountDeletionReaper.ts deletes this table's rows explicitly.
-- No load-bearing domain data — a preference object, not a canonical domain object.
--
-- Rollback:
--   DROP TABLE IF EXISTS briefing_layouts;

CREATE TABLE IF NOT EXISTS briefing_layouts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout           JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT briefing_layouts_one_per_user UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_briefing_layouts_org
  ON briefing_layouts (organization_id);

ALTER TABLE briefing_layouts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'briefing_layouts'
       AND policyname = 'briefing_layouts_tenant_isolation'
  ) THEN
    CREATE POLICY briefing_layouts_tenant_isolation ON briefing_layouts
      USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON briefing_layouts TO app_request;
