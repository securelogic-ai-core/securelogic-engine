-- 20260702_signal_match_suggestions_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on signal_match_suggestions.
-- Final table in the signal-link RLS batch.
--
-- Safe to enable now: the table's THREE writer surfaces are all tenant-safe at
-- the owner->app_request DATABASE_URL flip:
--   1. signalMatchSuggestions.ts routes (list / counts / accept / dismiss /
--      recompute-score) — asTenant()-wrapped. The accept handler runs its own
--      explicit pg.connect() transaction; under the wrap its BEGIN/COMMIT/
--      ROLLBACK rewrite to SAVEPOINT semantics (createSavepointClient) and its
--      client.release() is a no-op, so it nests safely in the request tx.
--   2. cyberSignalProcessingService.ts — 3 matcher INSERTs on pgElevated, which
--      bypasses RLS (owner) and writes an explicit organization_id.
--   3. llmControlMatcher.ts — INSERT + control read both run inside
--      withTenant(orgId), so post-flip they execute as app_request with
--      app.current_org_id set -> RLS-correct.
-- Wrapping the route family + the two elevated/scoped background writers is full
-- coverage; preserves the "policy => writers tenant-safe" invariant.
--
-- Rows are org-owned: organization_id is NOT NULL. The global-signal rule lives
-- on cyber_signals (no RLS) and is unaffected. NOT FORCE — owner bypasses;
-- INERT until the flip. Same policy shape as the signal_*_links tables.

ALTER TABLE signal_match_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signal_match_suggestions_tenant_isolation ON signal_match_suggestions;

CREATE POLICY signal_match_suggestions_tenant_isolation ON signal_match_suggestions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
