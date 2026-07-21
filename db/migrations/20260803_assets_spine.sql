-- Migration: assets_spine
-- Package: Enterprise Asset Registry — Phase 1 (Tier-0 registry spine)
--
-- Ships the thin `assets` identity table (ARCHITECTURE.md §2.1 Tier 0,
-- EAR-AD-2 — identity-only: NO name/criticality/owner copy, ever), nullable
-- `asset_id` back-pointers on the three backing tables (EAR-AD-3 — additive;
-- every existing (type,id) reference untouched), an idempotent in-migration
-- backfill, and repoints `asset_registry_v` so registry identity wins when
-- present. ADDITIVE ONLY: no existing column, row, or consumer changes.
--
-- Registry-row lifecycle:
--   * this backfill registers every pre-existing row (idempotent — UNIQUE
--     (org, backing_kind, backing_id) + ON CONFLICT DO NOTHING; re-running
--     the file is safe);
--   * registerAsset() (src/api/lib/assetRegistrar.ts) upserts on create paths
--     — FLAG-GATED (SECURELOGIC_ASSET_REGISTRY_ENABLED): while dark, live
--     routes gain ZERO new writes (§4 dark posture);
--   * rows created during the dark window are caught by the operator backfill
--     (scripts/backfill-asset-registry.ts — tracker operator-actions row) and,
--     until then, remain user-visible through the view's COALESCE fallback
--     below — a backing row can NEVER vanish from asset_registry_v.
--
-- Deletion integrity: assets.organization_id CASCADEs with the org (like every
-- org-owned table); backing_id is polymorphic no-FK-by-design (the codebase
-- convention), so route-level deletes deregister explicitly in the same tx
-- (aiSystems DELETE, enterpriseEntities DELETE — vendors has no delete route);
-- backing.asset_id is FK ON DELETE SET NULL so dropping a registry row can
-- never break a backing row.
--
-- RLS: enabled-not-forced from creation (inert until the app_request flip),
-- NULLIF('') GUC pattern per 20260719_enterprise_entities_rls.sql. app_request
-- gets full DML (route writes run through registerAsset inside the tenant tx).

CREATE TABLE IF NOT EXISTS assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_type       TEXT NOT NULL CHECK (asset_type IN (
                     'vendor', 'ai_system', 'application', 'database',
                     'cloud_resource', 'endpoint', 'api', 'identity_system',
                     'business_process', 'generic'
                   )),
  backing_kind     TEXT NOT NULL CHECK (backing_kind IN (
                     'vendors', 'ai_systems', 'enterprise_entities'
                   )),
  backing_id       UUID NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN (
                     'active', 'archived', 'retired'
                   )),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One registry row per backing row — the registerAsset()/backfill
  -- idempotency anchor.
  UNIQUE (organization_id, backing_kind, backing_id)
);

CREATE INDEX IF NOT EXISTS idx_assets_org_type ON assets (organization_id, asset_type);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'assets' AND policyname = 'assets_tenant_isolation'
  ) THEN
    CREATE POLICY assets_tenant_isolation ON assets
      USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON assets TO app_request;

-- EAR-AD-3: nullable back-pointer; SET NULL so registry-row removal can never
-- break a backing row.
ALTER TABLE vendors             ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE ai_systems          ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE enterprise_entities ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES assets(id) ON DELETE SET NULL;

-- ── Idempotent backfill (also the template for the operator script; the
--    entity_type CASE must stay in lockstep with ENTITY_TYPE_TO_ASSET_TYPE
--    in src/api/lib/assetRegistry.ts — unit-asserted). ─────────────────────

INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
SELECT organization_id, 'vendor', 'vendors', id FROM vendors
ON CONFLICT (organization_id, backing_kind, backing_id) DO NOTHING;

INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
SELECT organization_id, 'ai_system', 'ai_systems', id FROM ai_systems
ON CONFLICT (organization_id, backing_kind, backing_id) DO NOTHING;

INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
SELECT organization_id,
       CASE entity_type
         WHEN 'application' THEN 'application'
         WHEN 'data_store'  THEN 'database'
         ELSE 'generic'
       END,
       'enterprise_entities', id
FROM enterprise_entities
ON CONFLICT (organization_id, backing_kind, backing_id) DO NOTHING;

UPDATE vendors v SET asset_id = a.id
  FROM assets a
 WHERE a.backing_kind = 'vendors' AND a.backing_id = v.id
   AND a.organization_id = v.organization_id AND v.asset_id IS NULL;

UPDATE ai_systems s SET asset_id = a.id
  FROM assets a
 WHERE a.backing_kind = 'ai_systems' AND a.backing_id = s.id
   AND a.organization_id = s.organization_id AND s.asset_id IS NULL;

UPDATE enterprise_entities e SET asset_id = a.id
  FROM assets a
 WHERE a.backing_kind = 'enterprise_entities' AND a.backing_id = e.id
   AND a.organization_id = e.organization_id AND e.asset_id IS NULL;

-- ── Repoint the canonical view: registry identity wins when present; the
--    COALESCE fallback keeps every backing row visible even if a registry row
--    is missing (dark-window rows, pre-operator-backfill). Same column list /
--    order / types as Phase 0 (CREATE OR REPLACE requirement). ─────────────

CREATE OR REPLACE VIEW asset_registry_v AS
  SELECT
    COALESCE(a.id, v.id)                       AS asset_id,
    COALESCE(a.asset_type, 'vendor')           AS asset_type,
    v.organization_id                          AS organization_id,
    v.name                                     AS name,
    v.criticality                              AS criticality,
    v.owner_user_id                            AS owner_user_id,
    v.status                                   AS status,
    'vendors'::text                            AS backing_kind,
    v.id                                       AS backing_id,
    COALESCE(a.lifecycle_status, 'active')     AS lifecycle_status,
    v.created_at                               AS created_at,
    v.updated_at                               AS updated_at
  FROM vendors v
  LEFT JOIN assets a
    ON a.backing_kind = 'vendors' AND a.backing_id = v.id
   AND a.organization_id = v.organization_id
  UNION ALL
  SELECT
    COALESCE(a.id, s.id),
    COALESCE(a.asset_type, 'ai_system'),
    s.organization_id,
    s.name,
    s.criticality,
    s.owner_user_id,
    COALESCE(s.deployment_status, 'active'),
    'ai_systems'::text,
    s.id,
    COALESCE(a.lifecycle_status, 'active'),
    s.created_at,
    s.updated_at
  FROM ai_systems s
  LEFT JOIN assets a
    ON a.backing_kind = 'ai_systems' AND a.backing_id = s.id
   AND a.organization_id = s.organization_id
  UNION ALL
  SELECT
    COALESCE(a.id, e.id),
    COALESCE(a.asset_type,
      CASE e.entity_type
        WHEN 'application' THEN 'application'
        WHEN 'data_store'  THEN 'database'
        ELSE 'generic'
      END),
    e.organization_id,
    e.name,
    e.criticality,
    e.owner_user_id,
    e.status,
    'enterprise_entities'::text,
    e.id,
    COALESCE(a.lifecycle_status, 'active'),
    e.created_at,
    e.updated_at
  FROM enterprise_entities e
  LEFT JOIN assets a
    ON a.backing_kind = 'enterprise_entities' AND a.backing_id = e.id
   AND a.organization_id = e.organization_id;

-- CREATE OR REPLACE resets nothing ACL-wise but re-assert the invoker option
-- (PG >= 15) — same guard as 20260802.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW asset_registry_v SET (security_invoker = true)';
  END IF;
END $$;
