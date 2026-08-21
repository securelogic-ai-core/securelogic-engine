-- 20261033_asset_identifiers.sql
--
-- Multi-scheme asset identity (SL-OCC-1a, part 1 of 2).
--
-- NOT A SECOND ASSET INVENTORY. `assets` (20260803) is and remains the canonical
-- registry, and EAR-AD-4 already established that a detail asset's identity IS
-- its Tier-0 registry row. This table is an ALIAS INDEX over that registry:
-- it records the identifiers OTHER systems use for an asset SecureLogic already
-- knows about. It creates no assets, owns no attributes, and nothing reads it to
-- answer "what is this asset" — only "which asset did that scanner mean".
--
-- ── WHY THE DETAIL TABLES' external_ref IS NOT ENOUGH ──────────────────────
-- endpoints/cloud_resources/apis/identity_systems each carry ONE `external_ref`
-- — the ref of the ONE connector that created the row. Vulnerability intake has
-- the opposite shape: several sources, each with its own name for the same host,
-- none of them authoritative. A scanner export identifies a host by any mixture
-- of hostname, FQDN, IP, cloud resource id, instance id and its own internal
-- asset id, and which of those are present varies row to row.
--
-- Shape is deliberately the one canonical_product_external_ids (20260830)
-- already uses for the same problem on products: (scheme, identifier, source)
-- with a lookup index. Same problem, same solution, no third pattern.
--
-- ── THE TWO RULES THAT KEEP THIS HONEST ────────────────────────────────────
-- 1. AN IDENTIFIER DOES NOT UNIQUELY DETERMINE AN ASSET.
--    Uniqueness is (organization_id, asset_id, scheme, value) — it prevents
--    duplicate ROWS, and deliberately permits the same hostname to be claimed by
--    two assets, because in a real estate that HAPPENS (two `web01`s in two
--    domains). A UNIQUE (organization_id, scheme, value) would assert a global
--    uniqueness the enterprise does not have, and would fail imports with a
--    constraint violation at exactly the moment a human needs to disambiguate.
--    Ambiguity is therefore representable, and the resolver's job is to REFUSE
--    rather than to pick — see assetIdentity.ts.
--
-- 2. VOLATILE SCHEMES ARE NOT IDENTITY.
--    An IP address is a lease, not a name: today's 10.0.4.12 is tomorrow's other
--    host. It is stored, because it is what a scan report contains and dropping
--    it would lose evidence, but resolution never keys on it alone. That rule
--    lives in code (assetIdentity.ts) because it is a precedence policy, not an
--    integrity constraint, and it needs to be testable and explainable.

CREATE TABLE IF NOT EXISTS asset_identifiers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id         UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,

  -- The identifier NAMESPACE. Constrained because a free-text scheme silently
  -- forks the vocabulary ('ip' vs 'ip_address') and then nothing matches.
  scheme           TEXT        NOT NULL CHECK (scheme IN (
    'internal_id',        -- the customer's own asset/CMDB id
    'hostname',           -- short name; NOT globally unique
    'fqdn',               -- fully-qualified; unique far more often than hostname
    'ip',                 -- VOLATILE. Stored as evidence, never resolved on alone
    'mac',                -- stable per NIC, not per host
    'cloud_resource_id',  -- ARN / resource id / self-link
    'instance_id',        -- device or VM instance id
    'application_id',     -- application or service identifier
    'scanner_asset_id'    -- the scanner's own asset id — stable WITHIN that source
  )),
  value            TEXT        NOT NULL,
  -- WHO asserted this identifier: 'manual', or a source key. Kept because the
  -- same value from two sources is two pieces of evidence, not one.
  source           TEXT        NOT NULL,

  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT asset_identifier_value_nonempty CHECK (length(trim(value)) > 0),
  CONSTRAINT asset_identifier_source_nonempty CHECK (length(trim(source)) > 0),
  UNIQUE (organization_id, asset_id, scheme, value)
);

-- The resolution lookup: "which asset does this scanner's identifier mean".
-- Tenant-first so a lookup can never plan a cross-org scan.
CREATE INDEX IF NOT EXISTS idx_asset_identifiers_lookup
  ON asset_identifiers (organization_id, scheme, value);

CREATE INDEX IF NOT EXISTS idx_asset_identifiers_asset
  ON asset_identifiers (organization_id, asset_id);

ALTER TABLE asset_identifiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_identifiers_tenant_isolation ON asset_identifiers;
CREATE POLICY asset_identifiers_tenant_isolation ON asset_identifiers
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- No UPDATE: an alias is asserted or withdrawn, never edited into a different
-- one. Correcting a typo means removing the wrong row and adding the right one,
-- which leaves both facts visible instead of silently rewriting history.
GRANT SELECT, INSERT, DELETE ON asset_identifiers TO app_request;

COMMENT ON TABLE asset_identifiers IS
  'Alias index over the canonical `assets` registry: the identifiers OTHER systems use for an asset SecureLogic already knows. NOT an asset inventory — it creates no assets and owns no attributes. Uniqueness is per (org, asset, scheme, value): an identifier does NOT uniquely determine an asset, and the same hostname may legitimately be claimed by two assets. Volatile schemes (ip, mac) are stored as evidence but are never resolution keys on their own.';
