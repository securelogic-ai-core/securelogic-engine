-- ROLLBACK for 20261062_scope_item_domain (VA-Q2 P2).
--
-- Code rollback (redeploy the previous SHA) is always sufficient on its own:
-- the column is nullable, no read path REQUIRES it, and the 1.0.0 resolver
-- path is intact throughout Q2. Run this only if the schema itself must go.
-- Every step is idempotent. No data movement: dropping the column discards
-- only the computed domain stamp, which the 1.1.0 resolver recomputes
-- deterministically on any unissued engagement; issued engagements keep
-- their items (the freeze is on the row set and the question_set_hash, which
-- does not include `domain`).
--
-- When P3 (20261063, assessment_facts) lands, its rollback is appended to a
-- combined docs/release/ROLLBACK-20261062-20261063.sql per the plan (§E); this
-- file is the P2 half and stays valid on its own.

DROP INDEX IF EXISTS idx_vendor_engagement_scope_items_domain;
ALTER TABLE vendor_engagement_scope_items
  DROP CONSTRAINT IF EXISTS vendor_engagement_scope_items_domain_check;
ALTER TABLE vendor_engagement_scope_items
  DROP COLUMN IF EXISTS domain;
