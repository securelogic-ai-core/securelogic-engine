-- Migration: org_enterprise_context_caps
-- Package: Enterprise Context Layer (ECL) — Priority-5 Item 9 (Enterprise gating)
--
-- GATE A ruling (2026-07-04, operator): conservative default caps for the Platform
-- cohort — 10,000 enterprise entities / 50,000 enterprise edges per org. Both are
-- SEPARATE counters from max_monitored_entities and MUST NOT touch enforceEntityLimit
-- (S0 decision). Enterprise orgs may receive higher configurable caps later (operator
-- UPDATE, no DDL).
--
-- 1. Raise the entity-cap DEFAULT 1000 -> 10000 for new orgs, and migrate rows still
--    at the old default forward (do NOT clobber operator-tuned values).
-- 2. Add the edge cap (H1: enterprise_relationships writes were unmetered). Enforced at
--    the edge-create path by enforceEnterpriseEdgeLimit -> 409 enterprise_edge_limit_reached.
--
-- Additive; no new table. organizations already carries max_enterprise_entities (20260717).

ALTER TABLE organizations ALTER COLUMN max_enterprise_entities SET DEFAULT 10000;

UPDATE organizations
   SET max_enterprise_entities = 10000
 WHERE max_enterprise_entities = 1000;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS max_enterprise_edges INTEGER NOT NULL DEFAULT 50000;
