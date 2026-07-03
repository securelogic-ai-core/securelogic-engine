-- Migration: enterprise_entities
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 1
--
-- Creates:
--   enterprise_entities    — the canonical HEADER for NEW customer-context objects
--                            (assets, applications, business services, business units,
--                            departments, data stores, data classifications, identities).
--                            Org-scoped, ownership + provenance + confidence + criticality.
--   enterprise_data_stores — the first TYPED CHILD table. Holds the compliance-load-bearing
--                            attributes of a data_store entity (classification / residency /
--                            retention / encryption). Per the S0 decision (2026-07-03), such
--                            load-bearing attributes are TYPED COLUMNS, never a JSON blob.
--
-- Design authority: docs/architecture/enterprise-context/ENTERPRISE_CONTEXT_ARCHITECTURE.md
--   (AD-1 header + typed children; AD-1a taxonomy) and BUILD_SEQUENCE.md Priority-5 Slice-1
--   (S0-approved table strategy). vendors / ai_systems are NOT valid entity_type values —
--   they own their tables and are referenced later, never copied. No backfill, no dual-write.
--
-- Modifies: nothing. Additive only. No alters to vendors, ai_systems, cyber_signals, or any
--           existing enum. Empty at birth — zero backfill risk.
--
-- Tenant rules (enforced at the application layer per TENANT_ISOLATION_STANDARD.md §4;
--               RLS added inert in 20260719_enterprise_entities_rls.sql):
--   - organization_id is sourced from req.organizationContext, never the request body.
--   - owner_user_id (if set) MUST belong to the same organization — verified by the route
--     handler with a same-org pre-flight SELECT before INSERT/UPDATE.
--   - the child's organization_id is denormalized from its parent and MUST match it
--     (verified at the write path) so the child gets the standard NULLIF RLS policy.
--
-- Polymorphic provenance: source_type / source_id follow the codebase's established
--   polymorphic-by-query pattern (findings, evidence, signal_match_suggestions). source_id
--   has NO foreign key by design. provenance is a discriminator; only 'manual' is writable
--   in Slice 1 (CSV / connectors are later slices), the enum is forward-compatible.

CREATE TABLE IF NOT EXISTS enterprise_entities (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  entity_type      TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  description      TEXT        NULL,

  -- Ownership: the universal owner_user_id -> users pattern (no owner_email).
  owner_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  status           TEXT        NOT NULL DEFAULT 'active',
  criticality      TEXT        NULL,     -- lowercase vocabulary (matches vendors / ai_systems)
  confidence       TEXT        NULL,     -- provenance confidence band (matches findings.confidence)

  -- Provenance: polymorphic origin (source_id has no FK, by design) + a discriminator.
  source_type      TEXT        NULL,
  source_id        UUID        NULL,
  provenance       TEXT        NOT NULL DEFAULT 'manual',
  external_ref     TEXT        NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT enterprise_entities_entity_type_chk
    CHECK (entity_type IN (
      'asset', 'application', 'business_service', 'business_unit',
      'department', 'data_store', 'data_classification', 'identity'
    )),
  CONSTRAINT enterprise_entities_status_chk
    CHECK (status IN ('active', 'archived', 'retired')),
  CONSTRAINT enterprise_entities_criticality_chk
    CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT enterprise_entities_confidence_chk
    CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low', 'unverified')),
  CONSTRAINT enterprise_entities_provenance_chk
    CHECK (provenance IN ('manual', 'csv_import', 'connector'))
);

-- One entity per (org, type, name). Prevents duplicate context objects of the same
-- type and name within an organization.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_entities_unique_name
  ON enterprise_entities (organization_id, entity_type, name);

-- Hot read: list an org's entities of a given type.
CREATE INDEX IF NOT EXISTS idx_enterprise_entities_org_type
  ON enterprise_entities (organization_id, entity_type);

-- Hot read: list an org's entities, newest first.
CREATE INDEX IF NOT EXISTS idx_enterprise_entities_org_created
  ON enterprise_entities (organization_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- enterprise_data_stores — typed child (1:1 with a data_store entity)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS enterprise_data_stores (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_entity_id UUID        NOT NULL REFERENCES enterprise_entities(id) ON DELETE CASCADE,

  -- Denormalized org id (Tradeoff B1): the child carries its own organization_id so it
  -- gets the identical NULLIF RLS policy as every other table. MUST equal the parent's
  -- organization_id — verified at the write path.
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  data_classification  TEXT        NULL,     -- public / internal / confidential / restricted
  residency_region     TEXT        NULL,     -- free-text region (e.g. 'us-east-1', 'eu')
  retention_policy     TEXT        NULL,     -- free-text retention statement
  encryption_at_rest   BOOLEAN     NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT enterprise_data_stores_classification_chk
    CHECK (data_classification IS NULL OR data_classification IN (
      'public', 'internal', 'confidential', 'restricted'
    ))
);

-- 1:1 — a data_store entity has exactly one detail row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_data_stores_entity
  ON enterprise_data_stores (enterprise_entity_id);

-- Org-scoped read + RLS support.
CREATE INDEX IF NOT EXISTS idx_enterprise_data_stores_org
  ON enterprise_data_stores (organization_id, enterprise_entity_id);
