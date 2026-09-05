-- ROLLBACK-20261091.sql
--
-- Reverses 20261091_wa3_historical_question_version_freeze.sql.
--
-- The freeze wrote exactly one column on three tables, and only on rows where
-- it was NULL. Unwinding it means NULLing that column again for the same
-- bounded population — never for rows the live composition path stamped.
--
-- The population is reconstructed by the SAME predicate the migration used,
-- except that the item is now stamped rather than unstamped: a post-issue
-- scope item, composed before its own tenant's first immutable content record,
-- pointing at VERSION 1 of its bridge question. The live composition path
-- stamps at compose time, which is necessarily at or after that first record,
-- so it cannot be caught by this.
--
-- Reverting the freeze restores the COALESCE fallback for these items, which
-- means they go back to rendering LIVE canonical requirement text. Do not run
-- this after the WA-3 rulings 2/3/4 corpus edits have landed without first
-- accepting that those items' vendor-visible content will change.

BEGIN;

CREATE TEMP TABLE wa3_freeze_rollback_population ON COMMIT DROP AS
SELECT si.id AS item_id, si.organization_id, si.engagement_id, si.requirement_id
  FROM vendor_engagement_scope_items si
  JOIN vendor_engagements e
    ON e.id = si.engagement_id
   AND e.organization_id = si.organization_id
  JOIN question_versions qv
    ON qv.id = si.question_version_id
   AND qv.organization_id = si.organization_id
   AND qv.version = 1
 WHERE si.question_version_id IS NOT NULL
   AND e.status NOT IN ('draft', 'scoping', 'scoped', 'cancelled')
   AND si.created_at < (SELECT MIN(q2.published_at)
                          FROM question_versions q2
                         WHERE q2.organization_id = si.organization_id);

UPDATE requirement_response_revisions rev
   SET question_version_id = NULL
  FROM (SELECT rr.id AS response_id, rr.organization_id
          FROM requirement_responses rr
          JOIN wa3_freeze_rollback_population p
            ON p.engagement_id   = rr.engagement_id
           AND p.requirement_id  = rr.requirement_id
           AND p.organization_id = rr.organization_id) sub
 WHERE rev.response_id = sub.response_id
   AND rev.organization_id = sub.organization_id;

UPDATE requirement_responses rr
   SET question_version_id = NULL
  FROM wa3_freeze_rollback_population p
 WHERE rr.engagement_id   = p.engagement_id
   AND rr.requirement_id  = p.requirement_id
   AND rr.organization_id = p.organization_id;

UPDATE vendor_engagement_scope_items si
   SET question_version_id = NULL
  FROM wa3_freeze_rollback_population p
 WHERE si.id = p.item_id
   AND si.organization_id = p.organization_id;

DELETE FROM schema_migrations
 WHERE filename = '20261091_wa3_historical_question_version_freeze.sql';

COMMIT;
