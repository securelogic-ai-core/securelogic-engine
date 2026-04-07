-- Add unique index for platform-level insights (organization_id IS NULL).
--
-- Context:
-- The intelligence pipeline inserts signals and insights with organization_id = NULL,
-- meaning they are global platform intelligence (not org-specific). The existing
-- partial unique index uq_insights_org_signal covers org-scoped insights only
-- (WHERE organization_id IS NOT NULL). Without a matching index for the NULL case,
-- the pipeline creates duplicate insight rows for the same signal on every run.
--
-- This index closes that gap. The ON CONFLICT clause in insightGenerator.ts
-- targets this index when organization_id IS NULL.
--
-- Pre-flight deduplication:
-- Earlier pipeline runs created duplicate rows before this index existed.
-- We keep the most recently created row per signal and delete the rest
-- so the unique index can be built on clean data.

DELETE FROM insights
WHERE organization_id IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (signal_id) id
    FROM insights
    WHERE organization_id IS NULL
    ORDER BY signal_id, created_at DESC NULLS LAST
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_platform_signal
  ON insights (signal_id)
  WHERE organization_id IS NULL;
