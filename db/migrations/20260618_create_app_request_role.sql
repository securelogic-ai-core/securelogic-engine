-- Migration: create_app_request_role
-- Package:   A04-G1 phase 1 — Postgres RLS rollout
-- Decisions: A1 (non-owner application role) + B1 (transaction-wrapped
--            SET LOCAL app.current_org_id). See:
--              - docs/A04-G1-rls-rollout-plan.md §1
--              - docs/A04-G1-table-classification.md §5 (grant matrix)
--
-- Scope of this migration
-- -----------------------
-- Idempotently creates the non-owner role `app_request` and applies the
-- 4-tier grant matrix from the classification doc. This is purely a role
-- + grants change. It does NOT:
--
--   * Enable RLS on any table (phase 2+, one table per migration, each
--     with its own staging gate; see rollout plan §4 batches A–G).
--   * Repoint `DATABASE_URL` on any deployable. That flip is operator
--     work in the Render dashboard for the 5 services in §7 of the
--     classification doc, performed AFTER this migration auto-applies
--     to both staging and prod and AFTER `MIGRATION_DATABASE_URL` is
--     populated on both engine services.
--   * Set the role's password. The role is created with no password
--     (cannot log in until an ALTER USER sets one). Operator runs
--     `ALTER USER app_request PASSWORD '<secret>'` per environment via
--     the Render psql shell — different password in prod and staging.
--
-- Until the operator flips `DATABASE_URL` to the new role, every existing
-- connection continues as the owner exactly as it does today. This file
-- is therefore safe to land on both DBs ahead of any cutover.
--
-- Role attributes
-- ---------------
--   LOGIN          The engine will eventually connect via DATABASE_URL.
--   NOBYPASSRLS    The point of A1 — policies apply to this role.
--   NOSUPERUSER    Bounded blast radius.
--   NOCREATEDB     No database-level DDL.
--   NOCREATEROLE   Cannot create or escalate roles.
--   NOREPLICATION  Not a replication client.
--   (INHERIT left at the Postgres default — NOINHERIT is intentionally
--   NOT set, so future memberships in group roles flow grants through.)
--   No password — set per environment by the operator post-migration.
--
-- 4-tier grant matrix (Option Y — no ALTER DEFAULT PRIVILEGES)
-- ------------------------------------------------------------
--   Tier A — full DML (SELECT, INSERT, UPDATE, DELETE).
--            70 tables: every CUSTOMER-DATA table (52), every INDIRECT
--            table (11), and the 7 HYBRID tables whose write paths run
--            as app_request under a row-scoped policy. NULL-org writes
--            on the hybrid tables go through the owner-role elevated
--            path; the policy (added in phase 3 batch F) enforces that.
--
--   Tier B — SELECT + INSERT only. 2 tables: audit_log + security_audit_log.
--            UPDATE/DELETE intentionally withheld. The append-only
--            constraint on security_audit_log is enforced by the trigger
--            installed in 20260614_security_audit_log_immutable.sql; the
--            missing grant is defense-in-depth so a future revert of the
--            trigger does not silently re-open mutability for app_request.
--
--   Tier C — SELECT only. 5 tables:
--              organizations             (ROOT-TENANT — writes via admin /
--                                         Stripe / customer-signup paths
--                                         on the owner role; engine reads
--                                         the row only in attachOrganization-
--                                         Context to load entitlement)
--              email_suppressions        (SHARED-REF — read by alertEmail-
--                                         Service and customer-auth)
--              intelligence_brief_sources (SHARED-REF — source catalog)
--              published_artifacts       (SHARED-REF — issue serving)
--              risk_scale_presets        (SHARED-REF — preset catalog)
--
--   Tier D — NO GRANT. The absence of any grant IS the policy. Tables:
--              auth_anomaly_alerts       (owner-only — authAnomaly scan
--                                         runs on the elevated path)
--              webhook_events_processed  (owner-only — webhook idempotency
--                                         is a system-level concern)
--              worker_runs               (owner-only — worker telemetry)
--              schema_migrations         (owner-only — migrate runner
--                                         bookkeeping)
--            Listed here for audit completeness; intentionally no GRANT.
--
-- Option Y means every future customer-data table MUST be granted to
-- app_request in the same migration that creates it. The CI assertion to
-- catch missed grants is a A04-G1 phase 4 deliverable.
--
-- Sequences
-- ---------
-- USAGE,SELECT on every existing sequence in `public`. No SERIAL columns
-- exist in the current schema (UUID/`gen_random_uuid()` throughout), but
-- the schema_migrations.id SERIAL drives a sequence and any future SERIAL
-- column would need this grant — future-proofing here costs nothing.
--
-- Idempotency
-- -----------
-- CREATE ROLE wrapped in a DO block guarded by pg_roles lookup; re-runs
-- are no-ops. GRANT statements are inherently idempotent in Postgres
-- (re-granting an existing privilege does nothing). The whole migration
-- is therefore safe to re-apply if a manual reset is ever needed.

-- ---------------------------------------------------------------------
-- 1. Role
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    CREATE ROLE app_request
      LOGIN
      NOBYPASSRLS
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 2. Schema-level USAGE — prerequisite for any access to public objects.
-- ---------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO app_request;

-- ---------------------------------------------------------------------
-- 3. Tier A — full DML.
--    52 CUSTOMER-DATA + 11 INDIRECT + 7 HYBRID = 70 tables.
-- ---------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON
  actions,
  ai_governance_assessments,
  ai_systems,
  ai_system_vendor_dependencies,
  alert_sends,
  api_keys,
  api_usage_daily,
  assessments,
  control_assessments,
  control_mappings,
  controls,
  cyber_signals,
  dashboard_preferences,
  dependencies,
  dependency_assessments,
  domain_scores,
  evidence,
  findings,
  frameworks,
  governance_reviews,
  insights,
  intelligence_brief_items,
  intelligence_briefs,
  intelligence_brief_sends,
  intelligence_brief_subscribers,
  newsletter_deliveries,
  newsletter_issue_insights,
  newsletter_issues,
  obligation_assessments,
  obligation_mappings,
  obligations,
  organization_risk_scales,
  org_invites,
  org_sso_configs,
  password_history,
  policies,
  policy_control_links,
  posture_snapshots,
  reports,
  requirement_responses,
  requirements,
  risk_control_links,
  risk_obligation_links,
  risks,
  risk_scoring_weights,
  risk_settings,
  risk_treatments,
  signals,
  signal_ai_system_links,
  signal_control_links,
  signal_match_suggestions,
  signal_obligation_links,
  signal_vendor_links,
  subscribers,
  trends,
  trend_signals,
  user_alert_preferences,
  users,
  vendor_assessments,
  vendor_assurance_cuec_control_mappings,
  vendor_assurance_cuecs,
  vendor_assurance_documents,
  vendor_assurance_extractions,
  vendor_assurance_extraction_spans,
  vendor_assurance_field_overrides,
  vendor_assurance_review_decisions,
  vendor_reviews,
  vendors,
  webhook_deliveries,
  webhook_endpoints
TO app_request;

-- ---------------------------------------------------------------------
-- 4. Tier B — SELECT + INSERT only. NO UPDATE/DELETE.
--    The append-only invariant on security_audit_log is enforced by the
--    trigger from 20260614_security_audit_log_immutable.sql. The missing
--    grant here is defense-in-depth.
-- ---------------------------------------------------------------------

GRANT SELECT, INSERT ON
  audit_log,
  security_audit_log
TO app_request;

-- ---------------------------------------------------------------------
-- 5. Tier C — SELECT only.
--    organizations (ROOT-TENANT, all writes owner-side) + 4 SHARED-REF
--    tables read in the customer request path.
-- ---------------------------------------------------------------------

GRANT SELECT ON
  email_suppressions,
  intelligence_brief_sources,
  organizations,
  published_artifacts,
  risk_scale_presets
TO app_request;

-- ---------------------------------------------------------------------
-- 6. Tier D — NO GRANT. Listed for audit completeness only; the absence
--    of any GRANT statement on these tables IS the policy.
--
--      auth_anomaly_alerts        owner-only (authAnomaly elevated scan)
--      webhook_events_processed   owner-only (webhook idempotency)
--      worker_runs                owner-only (worker telemetry)
--      schema_migrations          owner-only (migrate runner bookkeeping)
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 7. Sequences — USAGE,SELECT on every existing sequence in public.
--    Required for INSERTs into any nextval()-defaulted column. The
--    schema is UUID-defaulted today; this future-proofs against any
--    later SERIAL/BIGSERIAL addition.
-- ---------------------------------------------------------------------

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_request;

-- Option Y: NO ALTER DEFAULT PRIVILEGES. Future tables require an
-- explicit GRANT in their creating migration. The CI assertion that
-- catches a missing grant is a A04-G1 phase 4 deliverable.
