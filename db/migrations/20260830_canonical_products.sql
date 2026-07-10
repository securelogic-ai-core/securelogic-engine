-- Migration: canonical_products (+ aliases, external_ids, versions)
-- Package: Enterprise Risk Graph convergence — Phase C1b
-- Docs: docs/architecture/proposals/CONVERGENCE-ROADMAP.md (C1),
--       docs/architecture/proposals/ENTERPRISE-RISK-GRAPH.md (ruling R1)
--
-- The Canonical Product is a GLOBAL, ORGANIZATION-NEUTRAL intermediate reference
-- entity (R1) used to normalize external product / package / version / service
-- identities BEFORE they are resolved to tenant assets. It is NOT the primary
-- customer-risk object: it carries NO organization_id, NO tenant ownership, and
-- NO business impact. Impact attaches to canonical tenant assets, never here.
--
-- Because these tables hold NO tenant data, they intentionally carry NO
-- organization_id and NO RLS — there is structurally nothing to leak across
-- tenants (this is the safest isolation posture, not an omission). The parallel
-- to `cyber_signals` global rows (organization_id NULL) is deliberate; here we go
-- further and drop the column entirely, since a Canonical Product is never
-- org-scoped even optionally.
--
-- DARK + ADDITIVE + REVERSIBLE: pure CREATE TABLE/INDEX, no writes to any
-- existing table, no backfill, no locks on existing tables. Nothing in a live
-- path reads or writes these tables yet (the C1 `canonicalProduct.ts` normalizer
-- + the C1b `canonicalProductStore.ts` writer have no callers). Rollback = drop
-- the four tables. `IF NOT EXISTS` throughout (idempotent; the runner wraps the
-- file in one transaction).
--
-- Duplicate handling is deterministic: `canonical_key` (the C1 normalizer's
-- org-neutral key) is UNIQUE, so the same product identity always maps to one
-- row (upsert anchor). Aliases / external ids / versions dedupe on their natural
-- keys. Provenance is preserved on every child row via `source` (+ the raw
-- string), so a normalized value can always be traced to where it came from.

-- ---------------------------------------------------------------
-- canonical_products — the global product identity (upsert anchor)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_products (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deterministic, org-neutral dedup key from canonicalProductIdentity() (C1):
  -- vendor_canonical|product_canonical|cve. UNIQUE = one row per identity.
  canonical_key      TEXT        NOT NULL UNIQUE,
  vendor_canonical   TEXT        NULL,
  product_canonical  TEXT        NULL,
  -- Best-effort human-readable label; never load-bearing for matching.
  display_name       TEXT        NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- canonical_product_aliases — alternate names + provenance
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_product_aliases (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID        NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  -- The original string as it arrived (provenance / reproducibility).
  alias_raw        TEXT        NOT NULL,
  -- The normalized form (single canonical normalizer).
  alias_canonical  TEXT        NOT NULL,
  -- Where this alias was observed (feed/source) — provenance.
  source           TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Deterministic dedup: one alias per (product, normalized value, source).
  UNIQUE (product_id, alias_canonical, source)
);
CREATE INDEX IF NOT EXISTS idx_canonical_product_aliases_canonical
  ON canonical_product_aliases (alias_canonical);

-- ---------------------------------------------------------------
-- canonical_product_external_ids — authoritative identifiers / external mappings
-- (CPE is one OPTIONAL scheme among many — never mandatory)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_product_external_ids (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID        NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  -- e.g. 'cpe', 'purl', 'swid', 'vendor_sku'. CPE optional (R2 — one evidence
  -- source, not a prerequisite).
  scheme       TEXT        NOT NULL,
  identifier   TEXT        NOT NULL,
  source       TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, scheme, identifier)
);
CREATE INDEX IF NOT EXISTS idx_canonical_product_external_ids_lookup
  ON canonical_product_external_ids (scheme, identifier);

-- ---------------------------------------------------------------
-- canonical_product_versions — version semantics + provenance
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_product_versions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID        NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  version_raw        TEXT        NOT NULL,
  version_normalized TEXT        NULL,
  source             TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, version_raw, source)
);
