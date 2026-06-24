-- 20260703_dashboard_preferences_rls.sql
--
-- A04-G1 phase-3 RLS: enable row-level security on dashboard_preferences.
-- 17th RLS table.
--
-- Safe to enable now: the table is read and written ONLY by
-- dashboardPreferences.ts, whose entire route family (5 handlers: GET/PUT/DELETE
-- personal + GET/PUT org_default) is asTenant()-wrapped. No other reader/writer.
--
-- organization_id is NOT NULL on EVERY row — both the personal rows
-- (preference_type='personal', user_id set) and the org_default rows
-- (preference_type='org_default', user_id NULL) carry an organization_id — so a
-- single org-scoped policy isolates all rows correctly. NOT FORCE — owner
-- bypasses; INERT until the flip.

ALTER TABLE dashboard_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_preferences_tenant_isolation ON dashboard_preferences;

CREATE POLICY dashboard_preferences_tenant_isolation ON dashboard_preferences
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
