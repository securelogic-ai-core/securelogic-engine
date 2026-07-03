-- Migration: applicability_affected_entities
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 4b (persistence)
--
-- The NORMALIZED blast radius of an applicability decision (AD-16 #5 / AD-15): the
-- enterprise entities reachable from the matched target within the org's context
-- graph — the answer the flat matcher cannot give. A queryable child table, NOT a
-- JSONB blob, so "every decision that affected entity Y" is answerable at query time.
--
-- Mirrors ApplicabilityResult.affected_entities: node_type/node_id, min_depth, and
-- the via_target the entity was reached from. node_id has no FK (polymorphic across
-- enterprise_entities / vendors / ai_systems / users, by design).
--
-- Denormalized organization_id (Tradeoff B1) for the identical NULLIF RLS policy.
-- WORM + inert RLS added in the worm/rls migrations. Additive only, empty at birth.

CREATE TABLE IF NOT EXISTS applicability_affected_entities (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    UUID        NOT NULL REFERENCES applicability_assessments(id) ON DELETE CASCADE,
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  node_type        TEXT        NOT NULL,
  node_id          UUID        NOT NULL,
  min_depth        SMALLINT    NOT NULL,

  -- The matched target this entity is reachable from.
  via_target_type  TEXT        NOT NULL,
  via_target_id    UUID        NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT applicability_affected_entities_via_target_type_chk
    CHECK (via_target_type IN ('vendor', 'ai_system', 'control', 'obligation')),
  CONSTRAINT applicability_affected_entities_min_depth_chk
    CHECK (min_depth >= 0)
);

-- Audit query: "every decision that affected <node_type:node_id>".
CREATE INDEX IF NOT EXISTS idx_applicability_affected_entities_node
  ON applicability_affected_entities (organization_id, node_type, node_id);

-- Fetch the full blast radius for one assessment.
CREATE INDEX IF NOT EXISTS idx_applicability_affected_entities_assessment
  ON applicability_affected_entities (assessment_id);
