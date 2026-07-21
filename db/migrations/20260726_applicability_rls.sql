-- Migration: applicability_rls
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 4b (persistence)
--
-- A04-G1 RLS: enable inert row-level security on the three applicability-decision
-- tables (applicability_assessments + applicability_evidence + applicability_affected_entities).
-- All three are org-owned (organization_id NOT NULL; the children carry their own
-- denormalized organization_id, Tradeoff B1, so each gets the identical NULLIF policy
-- shape rather than an EXISTS-parent policy).
--
-- NOT FORCE — the owner connection bypasses; policies are INERT until the owner ->
-- app_request DATABASE_URL flip. NULLIF cast is mandatory (pooled app_request resets
-- the GUC to '' not NULL between checkouts; a bare cast would throw). Same policy
-- shape as enterprise_entities / signal_match_suggestions.
--
-- GRANT DIVERGENCE (deliberate): these tables are WORM (20260725) — append-only. The
-- app_request role is granted only SELECT, INSERT (NEVER UPDATE/DELETE), implementing
-- AD-16's "UPDATE/DELETE revoked" literally as defense-in-depth: even in a future
-- FORCE-RLS world the app role cannot mutate the evidentiary record. The WORM trigger
-- is the primary immutability guarantee (fires regardless of role); this grant is the
-- belt-and-suspenders. (This differs from the full-DML grant on enterprise_entities,
-- which is NOT append-only.)
--
-- Tenant scoping (WITH CHECK) still applies to the permitted INSERT: a row stamped for
-- another org is rejected. Writer coverage: no writer until Slice 4c, which runs the
-- INSERTs inside the request/worker tenant transaction with app.current_org_id set and
-- organization_id sourced from context (never the body).

ALTER TABLE applicability_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS applicability_assessments_tenant_isolation ON applicability_assessments;
CREATE POLICY applicability_assessments_tenant_isolation ON applicability_assessments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE applicability_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS applicability_evidence_tenant_isolation ON applicability_evidence;
CREATE POLICY applicability_evidence_tenant_isolation ON applicability_evidence
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE applicability_affected_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS applicability_affected_entities_tenant_isolation ON applicability_affected_entities;
CREATE POLICY applicability_affected_entities_tenant_isolation ON applicability_affected_entities
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- WORM tables: SELECT + INSERT only for app_request (no UPDATE/DELETE — see header).
-- Tables created after 20260621 need explicit grants or app_request hits
-- "permission denied" instead of being RLS-filtered.
GRANT SELECT, INSERT ON applicability_assessments        TO app_request;
GRANT SELECT, INSERT ON applicability_evidence           TO app_request;
GRANT SELECT, INSERT ON applicability_affected_entities  TO app_request;
