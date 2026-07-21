-- Migration: asset_registry_view
-- Package: Enterprise Asset Registry — Phase 0 (contract + read-only view)
--
-- Ships `asset_registry_v`, the canonical Enterprise Asset projection
-- (docs/architecture/enterprise-asset-registry/ARCHITECTURE.md §2.1/§4 Phase 0):
-- a READ-ONLY VIEW federating the three existing asset-bearing tables —
-- vendors ∪ ai_systems ∪ enterprise_entities — into the shared header shape.
-- ZERO base-table churn: no new base table, no column changes, no writes, no
-- behavior change for any existing consumer. Trivially reversible (DROP VIEW).
--
-- EAR-AD-2: the registry is identity-only and the header is a VIEW — name /
-- criticality / owner are READ from the backing tables here, never copied, so
-- there is no drift surface. Until the Tier-0 `assets` table ships (Phase 1),
-- `asset_id` equals the backing row id; Phase 1 repoints the identity source
-- without changing this projection's shape. `lifecycle_status` is NULL until
-- Phase 1 for the same reason (contract stability — the column exists so the
-- TS contract does not change shape at Phase 1).
--
-- asset_type projection (§2.3): vendors → 'vendor'; ai_systems → 'ai_system';
-- enterprise_entities.entity_type 'application' → 'application' and
-- 'data_store' → 'database'; every other entity_type → 'generic' ('identity'
-- rows are identity ACCOUNTS, not identity systems, by design). This CASE must
-- stay in lockstep with ENTITY_TYPE_TO_ASSET_TYPE in
-- src/api/lib/assetRegistry.ts (unit-asserted).
--
-- status projection: vendors expose status (20260412 — NOT NULL DEFAULT
-- 'active', CHECK active/archived); ai_systems expose deployment_status
-- (fallback 'active'); enterprise_entities expose their status CHECK
-- (active/archived/retired).
--
-- Security model:
--   * The ONLY reader is the flag-gated, capability-gated, asTenant-wrapped
--     GET /api/assets route, which ALWAYS filters `WHERE organization_id = $1`
--     — explicit org discipline is the primary control (vendors/ai_systems
--     carry no RLS today; enterprise_entities does).
--   * Defense in depth: on PostgreSQL >= 15 the view is flipped to
--     security_invoker so the caller's role/RLS apply THROUGH the view (a
--     default view would run as the view owner and silently bypass
--     enterprise_entities RLS — the exact caveat recorded in
--     docs/A04-G1-table-classification.md). Guarded by server_version_num so
--     the migration stays portable to older engines, where the explicit
--     org predicate remains the (sole, already-required) control.
--   * app_request grants: SELECT on the view and on the two not-yet-granted
--     backing tables (vendors, ai_systems — enterprise_entities was granted in
--     20260719), so the A04-G1 role flip does not break the registry read path.
--     Additive read-only grants; no write surface is opened.
--
-- dataClassification: views hold no rows of their own; the three backing
-- tables are already registered in src/api/lib/dataClassification.ts. The
-- Phase-1 `assets` BASE table WILL register there per convention.

CREATE OR REPLACE VIEW asset_registry_v AS
  SELECT
    v.id                    AS asset_id,
    'vendor'::text          AS asset_type,
    v.organization_id       AS organization_id,
    v.name                  AS name,
    v.criticality           AS criticality,
    v.owner_user_id         AS owner_user_id,
    v.status                AS status,
    'vendors'::text         AS backing_kind,
    v.id                    AS backing_id,
    NULL::text              AS lifecycle_status,
    v.created_at            AS created_at,
    v.updated_at            AS updated_at
  FROM vendors v
  UNION ALL
  SELECT
    a.id,
    'ai_system'::text,
    a.organization_id,
    a.name,
    a.criticality,
    a.owner_user_id,
    COALESCE(a.deployment_status, 'active'),
    'ai_systems'::text,
    a.id,
    NULL::text,
    a.created_at,
    a.updated_at
  FROM ai_systems a
  UNION ALL
  SELECT
    e.id,
    CASE e.entity_type
      WHEN 'application' THEN 'application'
      WHEN 'data_store'  THEN 'database'
      ELSE 'generic'
    END,
    e.organization_id,
    e.name,
    e.criticality,
    e.owner_user_id,
    e.status,
    'enterprise_entities'::text,
    e.id,
    NULL::text,
    e.created_at,
    e.updated_at
  FROM enterprise_entities e;

-- security_invoker exists on PostgreSQL >= 15 (CI runs 16). On older engines
-- the view runs as owner; the route's mandatory org predicate is the control.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW asset_registry_v SET (security_invoker = true)';
  END IF;
END $$;

-- Read path for the constrained role (A04-G1). enterprise_entities SELECT was
-- granted in 20260719_enterprise_entities_rls.sql; vendors/ai_systems had no
-- app_request grant yet. Read-only — no INSERT/UPDATE/DELETE is granted.
GRANT SELECT ON asset_registry_v TO app_request;
GRANT SELECT ON vendors          TO app_request;
GRANT SELECT ON ai_systems       TO app_request;
