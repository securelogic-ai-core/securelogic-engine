-- Rollback for 20261081 (ADR-0012 Step 2 — evidence_links).
--
-- DESTRUCTIVE: drops every recorded link and every per-use confirmation. Each
-- confirmation is a human judgement about a specific use, so export first if the
-- table is non-empty:
--
--   SELECT * FROM evidence_links;
--
-- While the package is dark the table is empty by construction (no writer
-- exists), so this is normally a no-op drop.
--
-- Dropping this table also removes the ON DELETE RESTRICT that keeps an
-- in-use evidence row from being deleted. That is a LOOSENING: after this
-- rollback, DELETE FROM evidence succeeds again on artifacts that were in use.

DROP TRIGGER IF EXISTS trg_evidence_link_guard_update ON evidence_links;
DROP TRIGGER IF EXISTS trg_evidence_link_same_org ON evidence_links;
DROP TABLE IF EXISTS evidence_links;
DROP FUNCTION IF EXISTS evidence_link_guard_update();
DROP FUNCTION IF EXISTS evidence_link_same_org();
