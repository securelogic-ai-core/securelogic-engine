-- RENAMED 2026-08-15 from `20260522_alert_preferences.sql`.
--
-- The original filename carried a date ~5 weeks AFTER its own commit
-- (74d8ee64, 2026-04-17), so it sorted after
-- `20260504_user_alert_preferences_org_scope.sql`, which ALTERs the table this
-- file CREATEs. scripts/runMigrations.ts applies db/migrations in plain
-- filename order with no retry, so a from-scratch rebuild died at file 53 of
-- 222 with `relation "user_alert_preferences" does not exist`. Existing
-- environments were unaffected — they accreted these in commit order — but
-- disaster recovery by replay, new-environment provisioning and the documented
-- developer setup were all broken.
-- See docs/validation/migrate-from-scratch-defect.md.
--
-- The runner is filename-keyed, so environments that already applied the old
-- name will apply this file ONCE MORE under the new name and carry both rows
-- in schema_migrations (BUILD_SEQUENCE.md F-1). That is safe only because
-- every statement below is guarded: re-applying it over the fully migrated
-- schema changes nothing and preserves existing rows. Proven on real Postgres
-- by test/isolation/migrationFilenameOrder.test.ts — keep it that way if this
-- file is ever edited.

-- Alert preferences per user
CREATE TABLE IF NOT EXISTS user_alert_preferences (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  critical_finding_immediate BOOLEAN NOT NULL DEFAULT TRUE,
  daily_digest              BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_summary            BOOLEAN NOT NULL DEFAULT TRUE,
  high_finding_immediate    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

-- Deduplication log for sent alerts
CREATE TABLE IF NOT EXISTS alert_sends (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_type   TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_sends_dedup_idx
  ON alert_sends (user_id, alert_type, reference_id);

CREATE INDEX IF NOT EXISTS alert_sends_user_type_idx
  ON alert_sends (user_id, alert_type, sent_at DESC);
