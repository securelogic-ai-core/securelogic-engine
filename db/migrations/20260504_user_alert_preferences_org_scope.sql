-- Tenant isolation: scope user_alert_preferences by organization_id.
--
-- Standard reference: TENANT_ISOLATION_STANDARD.md §4 — every customer-data
-- SELECT/INSERT/UPDATE/DELETE MUST scope by organization_id.
--
-- Backfill is safe: user_alert_preferences.user_id is unique and references
-- users(id), so each row maps to exactly one organization_id. No row should
-- be missing an organization_id after the UPDATE; the NOT NULL flip will
-- fail loudly if any orphan rows exist (caller must investigate, not paper
-- over).

ALTER TABLE user_alert_preferences
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

UPDATE user_alert_preferences uap
   SET organization_id = u.organization_id
  FROM users u
 WHERE uap.user_id = u.id
   AND uap.organization_id IS NULL;

ALTER TABLE user_alert_preferences
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_alert_preferences_org
  ON user_alert_preferences(organization_id);
