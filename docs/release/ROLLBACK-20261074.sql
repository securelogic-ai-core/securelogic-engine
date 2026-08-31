-- ROLLBACK for 20261074_organization_tenant_class.sql
--
-- The migration adds one column to `organizations`, its CHECK, an index, and a
-- one-time backfill. Dropping the column reverses all of it.
--
-- WHAT IS LOST: the classification itself. After this rollback there is again NO
-- machine-readable way to tell synthetic validation fixture material from real
-- customer evidence, and any corpus measurement taken afterwards silently
-- includes both. Capture it first if it will be wanted:
--
--   CREATE TABLE organizations_tenant_class_backup_20261074 AS
--     SELECT id, name, tenant_class FROM organizations;
--
-- `realCorpusOrgPredicate()` in src/api/lib/tenantClass.ts reads this column, so
-- the application code must be rolled back with it or its queries will error.

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_tenant_class_check;
DROP INDEX IF EXISTS idx_organizations_tenant_class;
ALTER TABLE organizations DROP COLUMN IF EXISTS tenant_class;
