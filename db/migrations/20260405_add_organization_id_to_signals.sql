-- Add organization_id to signals table.
--
-- Context:
-- The intelligence worker (postgresSignalStore.ts) inserts organization_id
-- when saving signals, but the column was never added in a migration.
-- This caused every worker signal save to fail.
--
-- Design decisions:
-- - Nullable so existing rows and global signals are preserved.
-- - The signals API route does not filter by organization_id (signals are
--   global intelligence inputs; insights are the org-scoped output layer).
-- - IF NOT EXISTS makes this safe to re-run against a DB that already has
--   the column (e.g. manually altered on Render).

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_signals_organization_id
  ON signals (organization_id);
