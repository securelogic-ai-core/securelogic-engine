-- 20260908_asset_search_index_view.sql
--
-- asset_search_index_v — the shared, read-only search projection for canonical
-- assets: one row per (asset, searchable term). It is the data layer under the
-- cross-page asset-search resolver (src/api/lib/assetSearchResolver.ts), so
-- every search-capable surface resolves a term the SAME way instead of each
-- page hand-rolling its own subtype ILIKE joins.
--
-- Design:
--   * Built ON TOP of asset_registry_v — the registry view owns asset identity
--     (asset_id = COALESCE(assets-spine id, backing id)); this view never
--     re-derives it. Subtype terms join the backing detail table through
--     (backing_kind, backing_id, organization_id).
--   * backing_kind/backing_id are projected so federated consumers (vendors,
--     ai-systems, enterprise-context lists — keyed by BACKING id, EAR-AD-1)
--     can filter their own tables without re-resolving registry identity.
--   * Projects only identifiers that ALREADY EXIST in the schema:
--       name           — every registry arm (asset_registry_v.name)
--       hostname       — endpoints.hostname (holds FQDN/IP-shaped values too;
--                        dedicated fqdn/ip columns are a future schema decision)
--       cloud_account  — cloud_resources.account_id
--       alias          — canonical_product_aliases.alias_raw, reached through
--                        the org-scoped asset_product_identities bridge (the
--                        only alias store in the platform today)
--       external_ref   — the four detail tables + enterprise_entities
--     No alias/tag columns exist on tenant asset tables themselves; adding
--     them is a schema decision, not a search-view change.
--   * term_kind is a stable vocabulary the resolver ranks on
--     (name > hostname > cloud_account > alias > external_ref). Additive-only.
--   * Read-only projection: no table changes, no data movement, no triggers.
--
-- Tenancy: organization_id is projected from the org-scoped base rows; callers
-- MUST filter `WHERE organization_id = $1` (the platform's primary control —
-- vendors/ai_systems still carry no RLS). The alias arm is org-scoped through
-- asset_product_identities.organization_id (RLS-bearing); canonical_product_
-- aliases itself is org-neutral by design (20260830) and contributes no tenant
-- data of its own. security_invoker (PG >= 15) gives the RLS-bearing arms
-- defense-in-depth through the view, same as asset_registry_v.

CREATE OR REPLACE VIEW asset_search_index_v AS
  -- Every asset is searchable by its canonical display name.
  SELECT
    rv.organization_id AS organization_id,
    rv.asset_id        AS asset_id,
    rv.asset_type      AS asset_type,
    rv.backing_kind    AS backing_kind,
    rv.backing_id      AS backing_id,
    rv.name            AS term,
    'name'::text       AS term_kind
  FROM asset_registry_v rv
  UNION ALL
  -- Endpoint hostnames.
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         ep.hostname, 'hostname'::text
    FROM asset_registry_v rv
    JOIN endpoints ep
      ON rv.backing_kind = 'endpoints' AND rv.backing_id = ep.id
     AND rv.organization_id = ep.organization_id
   WHERE ep.hostname IS NOT NULL AND ep.hostname <> ''
  UNION ALL
  -- Cloud account / subscription / project identifier (single column today).
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         c.account_id, 'cloud_account'::text
    FROM asset_registry_v rv
    JOIN cloud_resources c
      ON rv.backing_kind = 'cloud_resources' AND rv.backing_id = c.id
     AND rv.organization_id = c.organization_id
   WHERE c.account_id IS NOT NULL AND c.account_id <> ''
  UNION ALL
  -- Product aliases: the org-scoped identity bridge names the asset, the
  -- org-neutral alias store names the strings the world knows the product by.
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         al.alias_raw, 'alias'::text
    FROM asset_registry_v rv
    JOIN asset_product_identities pi
      ON pi.organization_id = rv.organization_id AND pi.asset_id = rv.asset_id
    JOIN canonical_product_aliases al
      ON al.product_id = pi.canonical_product_id
   WHERE al.alias_raw IS NOT NULL AND al.alias_raw <> ''
  UNION ALL
  -- Connector-side native ids (external_ref) — the four detail tables…
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         c.external_ref, 'external_ref'::text
    FROM asset_registry_v rv
    JOIN cloud_resources c
      ON rv.backing_kind = 'cloud_resources' AND rv.backing_id = c.id
     AND rv.organization_id = c.organization_id
   WHERE c.external_ref IS NOT NULL AND c.external_ref <> ''
  UNION ALL
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         ep.external_ref, 'external_ref'::text
    FROM asset_registry_v rv
    JOIN endpoints ep
      ON rv.backing_kind = 'endpoints' AND rv.backing_id = ep.id
     AND rv.organization_id = ep.organization_id
   WHERE ep.external_ref IS NOT NULL AND ep.external_ref <> ''
  UNION ALL
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         ap.external_ref, 'external_ref'::text
    FROM asset_registry_v rv
    JOIN apis ap
      ON rv.backing_kind = 'apis' AND rv.backing_id = ap.id
     AND rv.organization_id = ap.organization_id
   WHERE ap.external_ref IS NOT NULL AND ap.external_ref <> ''
  UNION ALL
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         i.external_ref, 'external_ref'::text
    FROM asset_registry_v rv
    JOIN identity_systems i
      ON rv.backing_kind = 'identity_systems' AND rv.backing_id = i.id
     AND rv.organization_id = i.organization_id
   WHERE i.external_ref IS NOT NULL AND i.external_ref <> ''
  UNION ALL
  -- …and enterprise entities.
  SELECT rv.organization_id, rv.asset_id, rv.asset_type, rv.backing_kind, rv.backing_id,
         e.external_ref, 'external_ref'::text
    FROM asset_registry_v rv
    JOIN enterprise_entities e
      ON rv.backing_kind = 'enterprise_entities' AND rv.backing_id = e.id
     AND rv.organization_id = e.organization_id
   WHERE e.external_ref IS NOT NULL AND e.external_ref <> '';

-- security_invoker exists on PostgreSQL >= 15 (CI runs 16). On older engines
-- the view runs as owner; the resolver's mandatory org predicate is the control.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW asset_search_index_v SET (security_invoker = true)';
  END IF;
END $$;

-- Read-only surface for the A04-G1 role flip (same grant shape as the registry).
-- The alias arm reads the org-neutral alias store through security_invoker, so
-- app_request needs SELECT there too — read-only reference data, no tenant rows
-- (tenant scoping happens in the org-scoped, RLS-bearing bridge).
GRANT SELECT ON asset_search_index_v      TO app_request;
GRANT SELECT ON canonical_product_aliases TO app_request;
