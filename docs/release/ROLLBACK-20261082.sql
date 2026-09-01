-- Rollback for 20261082 (ADR-0012 Step 2 — evidence_lifecycle_events).
--
-- DESTRUCTIVE: drops an append-only governance history. The table exists
-- precisely so this history cannot be rewritten, so dropping it is the one
-- operation the design forbids in normal use. Export first if non-empty:
--
--   SELECT * FROM evidence_lifecycle_events ORDER BY occurred_at;
--
-- While the package is dark the table is empty by construction.
--
-- The DROP TABLE removes the WORM triggers with it; the shared
-- worm_guard_mutation function is left in place because eight other tables use
-- it. Never drop that function.

DROP TABLE IF EXISTS evidence_lifecycle_events;
