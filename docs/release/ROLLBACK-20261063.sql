-- ROLLBACK for 20261063_assessment_facts (VA-Q2 P3).
--
-- Code rollback (redeploy the previous SHA) is sufficient on its own: no read
-- path outside this package requires the table, and the scope route of the
-- previous SHA reads the 13 inherent columns directly. Run this only if the
-- schema itself must go. Every step is idempotent.
--
-- DATA LOSS: this drops every declared fact (PUT /facts) and every mirror row.
-- Mirrors are recomputed deterministically by the next scope resolve; DECLARED
-- facts (intake / internal_user) are NOT recoverable from any other table.
-- Take a snapshot first if any customer PUT has happened on the environment:
--   COPY (SELECT * FROM assessment_facts) TO '/tmp/assessment_facts.csv' CSV HEADER;
--
-- P2's half (20261062) is docs/release/ROLLBACK-20261062.sql; run it AFTER
-- this file when both must go (P3 is stacked on P2).

DROP TRIGGER IF EXISTS assessment_facts_enforce_immutability ON assessment_facts;
DROP TRIGGER IF EXISTS assessment_facts_check_subject ON assessment_facts;
DROP FUNCTION IF EXISTS assessment_facts_enforce_immutability();
DROP FUNCTION IF EXISTS assessment_facts_check_subject();
DROP POLICY IF EXISTS assessment_facts_tenant_isolation ON assessment_facts;
DROP TABLE IF EXISTS assessment_facts;
