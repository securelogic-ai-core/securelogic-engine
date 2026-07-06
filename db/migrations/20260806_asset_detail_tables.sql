-- Migration: asset_detail_tables
-- Package: Enterprise Asset Registry — Phase 3a (native asset types)
--
-- Onboards the four genuinely-absent asset types (ARCHITECTURE.md §2.3) as
-- Tier-1 DETAIL tables following the ECL S0 rule (load-bearing attributes are
-- typed columns, never JSON) and the enterprise_data_stores precedent
-- (20260718/20260719): denormalized organization_id for the standard NULLIF
-- RLS policy, RLS enabled-not-forced from creation, full app_request DML.
--
--   cloud_resources   — provider/account/region/resource_type
--   endpoints         — hostname/os/exposure/last_seen_at
--   apis              — protocol/auth_method/exposure
--   identity_systems  — idp_vendor/protocol
--
-- Each detail table IS the backing row for its registry asset
-- (assets.backing_kind = table name, EAR-AD-1 federation): the shared header
-- columns (name/criticality/owner/status) live HERE — the registry stays
-- identity-only (EAR-AD-2) and asset_registry_v gains one arm per table.
-- `external_ref` carries the connector-side id for sync dedup (Phase 3b).
--
-- Creation paths (POST /api/assets, connector sync) are themselves reachable
-- only behind SECURELOGIC_ASSET_REGISTRY_ENABLED and register the asset in
-- the same transaction — so unlike Phase 1's live tables there is NO
-- dark-window registration gap for these types. Additive only; no existing
-- object changes behavior.

-- ── shared shape ×4 ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cloud_resources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  criticality      TEXT CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low')),
  owner_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'retired')),
  external_ref     TEXT,
  asset_id         UUID REFERENCES assets(id) ON DELETE SET NULL,
  provider         TEXT NOT NULL CHECK (provider IN ('aws', 'azure', 'gcp', 'other')),
  account_id       TEXT,
  region           TEXT,
  resource_type    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_resources_org_extref
  ON cloud_resources (organization_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cloud_resources_org ON cloud_resources (organization_id);

CREATE TABLE IF NOT EXISTS endpoints (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  criticality      TEXT CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low')),
  owner_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'retired')),
  external_ref     TEXT,
  asset_id         UUID REFERENCES assets(id) ON DELETE SET NULL,
  hostname         TEXT,
  os               TEXT,
  exposure         TEXT CHECK (exposure IS NULL OR exposure IN ('internal', 'internet_facing', 'isolated')),
  last_seen_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_endpoints_org_extref
  ON endpoints (organization_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_endpoints_org ON endpoints (organization_id);

CREATE TABLE IF NOT EXISTS apis (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  criticality      TEXT CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low')),
  owner_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'retired')),
  external_ref     TEXT,
  asset_id         UUID REFERENCES assets(id) ON DELETE SET NULL,
  protocol         TEXT CHECK (protocol IS NULL OR protocol IN ('rest', 'graphql', 'grpc', 'soap', 'other')),
  auth_method      TEXT CHECK (auth_method IS NULL OR auth_method IN ('none', 'api_key', 'oauth2', 'mtls', 'basic', 'other')),
  exposure         TEXT CHECK (exposure IS NULL OR exposure IN ('internal', 'internet_facing', 'partner')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apis_org_extref
  ON apis (organization_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_apis_org ON apis (organization_id);

CREATE TABLE IF NOT EXISTS identity_systems (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  criticality      TEXT CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low')),
  owner_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'retired')),
  external_ref     TEXT,
  asset_id         UUID REFERENCES assets(id) ON DELETE SET NULL,
  idp_vendor       TEXT,
  protocol         TEXT CHECK (protocol IS NULL OR protocol IN ('saml', 'oidc', 'ldap', 'radius', 'proprietary', 'other')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_systems_org_extref
  ON identity_systems (organization_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_identity_systems_org ON identity_systems (organization_id);

-- ── RLS (enterprise_entities pattern: enabled, NOT FORCE, NULLIF GUC) ──────

ALTER TABLE cloud_resources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE endpoints        ENABLE ROW LEVEL SECURITY;
ALTER TABLE apis             ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_systems ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cloud_resources', 'endpoints', 'apis', 'identity_systems'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I
           USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
           WITH CHECK (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
        t || '_tenant_isolation', t
      );
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON cloud_resources  TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON endpoints        TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON apis             TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity_systems TO app_request;

-- ── registry: admit the four new backing kinds ─────────────────────────────

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_backing_kind_check;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_backing_kind_chk;
ALTER TABLE assets
  ADD CONSTRAINT assets_backing_kind_chk
    CHECK (backing_kind IN (
      'vendors', 'ai_systems', 'enterprise_entities',
      'cloud_resources', 'endpoints', 'apis', 'identity_systems'
    ));

-- ── asset_registry_v: one arm per new backing kind (EAR-AD-2 unchanged —
--    header read from backing; identity from the registry with COALESCE
--    fallback, same as 20260803). Column list/order/type identical. ─────────

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
    s.organization_id, s.name, s.criticality, s.owner_user_id,
    COALESCE(s.deployment_status, 'active'),
    'ai_systems'::text, s.id,
    COALESCE(a.lifecycle_status, 'active'),
    s.created_at, s.updated_at
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
    e.organization_id, e.name, e.criticality, e.owner_user_id, e.status,
    'enterprise_entities'::text, e.id,
    COALESCE(a.lifecycle_status, 'active'),
    e.created_at, e.updated_at
  FROM enterprise_entities e
  LEFT JOIN assets a
    ON a.backing_kind = 'enterprise_entities' AND a.backing_id = e.id
   AND a.organization_id = e.organization_id
  UNION ALL
  SELECT
    COALESCE(a.id, c.id), COALESCE(a.asset_type, 'cloud_resource'),
    c.organization_id, c.name, c.criticality, c.owner_user_id, c.status,
    'cloud_resources'::text, c.id,
    COALESCE(a.lifecycle_status, 'active'), c.created_at, c.updated_at
  FROM cloud_resources c
  LEFT JOIN assets a
    ON a.backing_kind = 'cloud_resources' AND a.backing_id = c.id
   AND a.organization_id = c.organization_id
  UNION ALL
  SELECT
    COALESCE(a.id, ep.id), COALESCE(a.asset_type, 'endpoint'),
    ep.organization_id, ep.name, ep.criticality, ep.owner_user_id, ep.status,
    'endpoints'::text, ep.id,
    COALESCE(a.lifecycle_status, 'active'), ep.created_at, ep.updated_at
  FROM endpoints ep
  LEFT JOIN assets a
    ON a.backing_kind = 'endpoints' AND a.backing_id = ep.id
   AND a.organization_id = ep.organization_id
  UNION ALL
  SELECT
    COALESCE(a.id, ap.id), COALESCE(a.asset_type, 'api'),
    ap.organization_id, ap.name, ap.criticality, ap.owner_user_id, ap.status,
    'apis'::text, ap.id,
    COALESCE(a.lifecycle_status, 'active'), ap.created_at, ap.updated_at
  FROM apis ap
  LEFT JOIN assets a
    ON a.backing_kind = 'apis' AND a.backing_id = ap.id
   AND a.organization_id = ap.organization_id
  UNION ALL
  SELECT
    COALESCE(a.id, i.id), COALESCE(a.asset_type, 'identity_system'),
    i.organization_id, i.name, i.criticality, i.owner_user_id, i.status,
    'identity_systems'::text, i.id,
    COALESCE(a.lifecycle_status, 'active'), i.created_at, i.updated_at
  FROM identity_systems i
  LEFT JOIN assets a
    ON a.backing_kind = 'identity_systems' AND a.backing_id = i.id
   AND a.organization_id = i.organization_id;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW asset_registry_v SET (security_invoker = true)';
  END IF;
END $$;
