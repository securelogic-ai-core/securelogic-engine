-- Durable backup store for signed issue artifacts.
--
-- Context:
-- The /issues/latest and /issues/:issueNumber routes read from Redis.
-- Redis has no guaranteed persistence — a restart without RDB/AOF flushes all
-- published artifacts. This table is the authoritative durable record.
--
-- Design:
-- - issue_number is the primary key — the same integer used as the Redis key
--   suffix (issues:artifact:{N}). Consistent across both stores.
-- - artifact_json is the full signed artifact as produced by publishIssueArtifact.
-- - bytes is stored to avoid recomputing on read; also useful for size monitoring.
-- - published_at is immutable after first write (ON CONFLICT DO UPDATE preserves it
--   via COALESCE if re-published with same number).
-- - All statements use IF NOT EXISTS so migration is safe to re-run.

CREATE TABLE IF NOT EXISTS published_artifacts (
  issue_number  INT          PRIMARY KEY,
  artifact_json TEXT         NOT NULL,
  bytes         INT          NOT NULL,
  published_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_published_artifacts_published_at
  ON published_artifacts (published_at DESC);
