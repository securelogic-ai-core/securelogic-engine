-- Migration: enterprise_relationships
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 2 (relationship graph)
--
-- Creates:
--   enterprise_relationships — a GENERIC, additive edge table for NEW relationships
--     between context nodes. Polymorphic endpoints (from_type/from_id, to_type/to_id)
--     may reference either an enterprise_entities row OR an existing canonical object
--     (vendor, ai_system, user). Endpoints have NO foreign keys, by design (same
--     polymorphic-by-query pattern as signal_match_suggestions / findings / evidence).
--
-- Design authority: docs/architecture/enterprise-context/ENTERPRISE_CONTEXT_ARCHITECTURE.md
--   AD-3 (generic edge for NEW relationships; the read-time resolver UNIONs the existing
--   TYPED edges — dependencies, ai_system_vendor_dependencies, signal_*_links, risk_*_links
--   — but this table NEVER replaces them) and AD-13 (typed-edge-authoritative). The
--   resolver + graph traversal (recursive CTE, global-signal special-case, load-tested)
--   are a SEPARATE later slice (S2b) — this migration ships the edge substrate only.
--
-- Modifies: nothing. Additive only. Empty at birth — zero backfill.
--
-- Tenant rules (TENANT_ISOLATION_STANDARD.md §1, §4; RLS added inert in
--               20260721_enterprise_relationships_rls.sql):
--   - organization_id is sourced from req.organizationContext, never the body.
--   - BOTH endpoints MUST belong to the same organization — verified at the write path
--     with a two-endpoint same-org pre-flight (dispatch node_type -> its table) before
--     insert. Cross-org edges are structurally forbidden. An edge is strictly intra-org.
--
-- Soft-delete: deleted_at (matches the signal_*_links convention). The partial unique
--   index excludes soft-deleted rows so an edge can be re-created after deletion.

CREATE TABLE IF NOT EXISTS enterprise_relationships (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Polymorphic endpoints. No FK by design; node_type is a closed enum, id existence +
  -- same-org membership are verified at the route layer before insert.
  from_type          TEXT        NOT NULL,
  from_id            UUID        NOT NULL,
  to_type            TEXT        NOT NULL,
  to_id              UUID        NOT NULL,

  relationship_type  TEXT        NOT NULL,
  note               TEXT        NULL,

  created_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ NULL,

  -- Node types an endpoint may reference: a NEW context entity, or an existing
  -- canonical object the graph points AT (never contains). Extend via migration + the
  -- route dispatch map + this CHECK together.
  CONSTRAINT enterprise_relationships_from_type_chk
    CHECK (from_type IN ('enterprise_entity', 'vendor', 'ai_system', 'user')),
  CONSTRAINT enterprise_relationships_to_type_chk
    CHECK (to_type IN ('enterprise_entity', 'vendor', 'ai_system', 'user')),

  CONSTRAINT enterprise_relationships_type_chk
    CHECK (relationship_type IN (
      'depends_on', 'runs_on', 'owned_by', 'part_of', 'serves', 'processes_data_in'
    )),

  -- No self-edges (a node cannot relate to itself with the same type).
  CONSTRAINT enterprise_relationships_no_self_edge_chk
    CHECK (NOT (from_type = to_type AND from_id = to_id))
);

-- One live edge per (org, from, to, relationship_type). Excludes soft-deleted rows so
-- the edge can be recreated after deletion.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_relationships_unique_live
  ON enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
  WHERE deleted_at IS NULL;

-- Hot read: outbound edges from a node (resolver / neighbourhood query).
CREATE INDEX IF NOT EXISTS idx_enterprise_relationships_from
  ON enterprise_relationships (organization_id, from_type, from_id)
  WHERE deleted_at IS NULL;

-- Hot read: inbound edges to a node.
CREATE INDEX IF NOT EXISTS idx_enterprise_relationships_to
  ON enterprise_relationships (organization_id, to_type, to_id)
  WHERE deleted_at IS NULL;
