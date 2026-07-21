-- Migration: enterprise_relationships_asset_expansion
-- Package: Enterprise Asset Registry — graph substrate expansion (EAR-AD-4)
--
-- Decision (EAR-AD-4, ratified): infrastructure/asset relationships live in the
-- EXISTING enterprise_relationships generic edge table — there is NO new
-- enterprise_asset_relationships table. The shipped recursive resolver
-- (enterpriseGraphResolver.ts) and the AD-13 typed-edge union are reused as-is
-- for traversal/blast-radius: both are vocabulary-agnostic, so this migration
-- requires ZERO resolver changes. Rationale: a second edge table would split the
-- graph, force a second resolver UNION arm + second RLS/cap/audit surface, and
-- contradict the asset-registry design's own §3.1 ruling that
-- enterprise_relationships is "already the general edge substrate" (REUSE).
--
-- Widens two vocabularies, additively:
--
--   1. Endpoint node types: + 'asset' — an edge endpoint may reference a Tier-0
--      asset registry row (docs/architecture/enterprise-asset-registry/
--      ARCHITECTURE.md, EAR-AD-2/3). SCHEMA-DARK: the route layer's NODE_TYPES /
--      NODE_TYPE_TABLE gate (enterpriseRelationshipValidation.ts) does NOT admit
--      'asset' until the `assets` table ships (registry Phase 1) — there is no
--      table to run the two-endpoint same-org pre-flight against yet. Declaring
--      it here means Phase 1 flips it on route-side only, with no edge migration.
--
--   2. relationship_type: + 6 infrastructure edges (live immediately between the
--      existing node types — application/data_store/asset/identity entities,
--      vendors, ai_systems):
--        hosted_on         workload -> hosting infrastructure
--        connects_to       network / integration topology
--        stores_data_in    system -> data store (at rest; complements
--                          processes_data_in, which is in-processing)
--        authenticates_via system -> identity provider / identity system
--        exposed_via       internal system -> public-facing surface (api/endpoint)
--        managed_by        asset -> operator (MSP vendor / user); operational
--                          management, distinct from owned_by (accountability)
--
-- Same shape as 20260731_jobs_applicability_reassess.sql: ADDITIVE ONLY, no data
-- touched, every existing endpoint type, relationship_type value, and edge row
-- remains valid. ECL context edges are unaffected. RLS
-- (20260721_enterprise_relationships_rls.sql), the partial unique index, the
-- no-self-edge CHECK, the per-org edge cap, and the dataClassification entry all
-- apply to the new vocabulary unchanged — none are modified here. Idempotent
-- (DROP IF EXISTS + ADD).
--
-- Rollback (manual, forward-only convention): re-add the previous constraints
-- after confirming no surviving rows use 'asset' endpoints or the six new
-- relationship_type values.

ALTER TABLE enterprise_relationships
  DROP CONSTRAINT IF EXISTS enterprise_relationships_from_type_chk;

ALTER TABLE enterprise_relationships
  ADD CONSTRAINT enterprise_relationships_from_type_chk
    CHECK (from_type IN ('enterprise_entity', 'vendor', 'ai_system', 'user', 'asset'));

ALTER TABLE enterprise_relationships
  DROP CONSTRAINT IF EXISTS enterprise_relationships_to_type_chk;

ALTER TABLE enterprise_relationships
  ADD CONSTRAINT enterprise_relationships_to_type_chk
    CHECK (to_type IN ('enterprise_entity', 'vendor', 'ai_system', 'user', 'asset'));

ALTER TABLE enterprise_relationships
  DROP CONSTRAINT IF EXISTS enterprise_relationships_type_chk;

ALTER TABLE enterprise_relationships
  ADD CONSTRAINT enterprise_relationships_type_chk
    CHECK (relationship_type IN (
      'depends_on', 'runs_on', 'owned_by', 'part_of', 'serves', 'processes_data_in',
      'hosted_on', 'connects_to', 'stores_data_in', 'authenticates_via',
      'exposed_via', 'managed_by'
    ));
