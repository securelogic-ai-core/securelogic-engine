-- 20260827_business_process_entity_type.sql
--
-- EAR canonical asset-creation flow: promote `business_process` from a
-- registry-only asset_type (offered in the picker but with no backing store)
-- to a first-class enterprise_entities.entity_type, so "Create Business
-- Process" lands a real, distinct record instead of collapsing to `generic`.
--
-- This is the additive schema step ratified in ARCHITECTURE.md §2.3
-- ("business_process via enterprise_entities enum add"). It is NON-DESTRUCTIVE:
--   * widens the entity_type CHECK (drop + re-add, no data change);
--   * repoints asset_registry_v so the enterprise_entities arm projects
--     entity_type='business_process' → asset_type='business_process'
--     (COALESCE(a.asset_type, CASE ...) — the registry spine still wins when a
--     row is registered; the CASE is only the pre-registry fallback, kept in
--     lockstep with ENTITY_TYPE_TO_ASSET_TYPE per assetRegistry.test.ts).
--
-- No typed child table is added here: a business_process v1 carries only the
-- shared enterprise_entities header (name/description/criticality/owner). Rich
-- process attributes (RTO/RPO/owner department) are a future typed child
-- (enterprise_data_stores precedent) — documented, not faked.
--
-- Stays flag-dark (GATE B): reachable only behind SECURELOGIC_ENTERPRISE_
-- CONTEXT_ENABLED + SECURELOGIC_ASSET_REGISTRY_ENABLED. No production enable.

-- ── 1. Widen the entity_type CHECK (matches the 20260806 backing_kind idiom) ──
ALTER TABLE enterprise_entities DROP CONSTRAINT IF EXISTS enterprise_entities_entity_type_check;
ALTER TABLE enterprise_entities DROP CONSTRAINT IF EXISTS enterprise_entities_entity_type_chk;
ALTER TABLE enterprise_entities
  ADD CONSTRAINT enterprise_entities_entity_type_chk
    CHECK (entity_type IN (
      'asset', 'application', 'business_service', 'business_unit',
      'department', 'data_store', 'data_classification', 'identity',
      'business_process'
    ));

-- ── 2. Repoint asset_registry_v (same column list/order/types as 20260806;
--      only the enterprise_entities arm's CASE gains the business_process WHEN).
--      Registry identity wins via COALESCE; the CASE is the pre-registry
--      fallback and must mirror ENTITY_TYPE_TO_ASSET_TYPE. ────────────────────
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
        WHEN 'application'      THEN 'application'
        WHEN 'data_store'       THEN 'database'
        WHEN 'business_process' THEN 'business_process'
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

-- security_invoker exists on PostgreSQL >= 15 (CI runs 16). On older engines
-- the view runs as owner; the route's mandatory org predicate is the control.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW asset_registry_v SET (security_invoker = true)';
  END IF;
END $$;

-- Read-only surface (idempotent re-grant; the view is repointed above).
GRANT SELECT ON asset_registry_v TO app_request;
GRANT SELECT ON vendors          TO app_request;
GRANT SELECT ON ai_systems       TO app_request;
