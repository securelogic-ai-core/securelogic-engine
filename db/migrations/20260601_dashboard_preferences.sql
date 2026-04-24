-- Dashboard preferences: per-user tile visibility, optional org-wide default.
-- Layout is stored as a JSONB array of { id, visible, order } tile configs.
-- preference_type='personal' rows are keyed by (organization_id, user_id).
-- preference_type='org_default' rows have user_id NULL and are keyed by
-- organization_id alone.

CREATE TABLE IF NOT EXISTS dashboard_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  preference_type TEXT NOT NULL DEFAULT 'personal',
  layout          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique indexes handle nullable user_id correctly.
-- Postgres treats NULLs as distinct in regular UNIQUE constraints, which
-- would allow duplicate org-default rows — these partial indexes prevent that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_prefs_personal
  ON dashboard_preferences (organization_id, user_id)
  WHERE preference_type = 'personal';

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_prefs_org_default
  ON dashboard_preferences (organization_id)
  WHERE preference_type = 'org_default' AND user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_prefs_org_user
  ON dashboard_preferences (organization_id, user_id);
