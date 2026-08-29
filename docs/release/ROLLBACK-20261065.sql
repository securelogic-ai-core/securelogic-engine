-- ROLLBACK for 20261065_engagement_applicability (VA-926).
--
-- Code rollback (redeploy the previous SHA) is sufficient on its own: nothing
-- outside this package reads the table, and the resolver's behaviour — what is
-- asked, and what is stored in vendor_engagement_scope_items — is unchanged by
-- it. The write is additive and best-effort. Run this only if the schema itself
-- must go.
--
-- DATA LOSS: this drops every applicability determination ever recorded. Those
-- rows are the ONLY record that a rule fired for a requirement whose questions
-- were truncated — the whole point of #926 — and they are not reconstructible
-- afterwards, because the inputs that produced them (facts, obligations,
-- scope_tags) are mutable and will have moved on. Snapshot first:
--   COPY (SELECT * FROM engagement_applicability) TO '/tmp/applicability.csv' CSV HEADER;
--
-- Every step is idempotent.

DROP TRIGGER IF EXISTS engagement_applicability_no_update ON engagement_applicability;
DROP TRIGGER IF EXISTS engagement_applicability_check_engagement ON engagement_applicability;
DROP FUNCTION IF EXISTS engagement_applicability_immutable();
DROP FUNCTION IF EXISTS engagement_applicability_check_engagement();

DROP POLICY IF EXISTS engagement_applicability_tenant_isolation ON engagement_applicability;

DROP INDEX IF EXISTS uq_engagement_applicability_determination;
DROP INDEX IF EXISTS idx_engagement_applicability_engagement;
DROP INDEX IF EXISTS idx_engagement_applicability_org_domain;

DROP TABLE IF EXISTS engagement_applicability;
