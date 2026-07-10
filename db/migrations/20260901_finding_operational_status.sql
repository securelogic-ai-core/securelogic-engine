-- ============================================================
-- 20260901_finding_operational_status.sql — Finding lifecycle C6 (two-axis)
--
-- Implements the schema half of docs/specs/finding-lifecycle-spec.md
-- (RATIFIED 2026-07-10), §6 "Migrations (additive — Phase C6)":
--
--   1. findings.operational_status — the SYSTEM-DERIVED axis (§1.1), a pure
--      function of linked Actions, recomputed in the same transaction that
--      changes them (findingLifecycle.ts is the single writer). Backfilled
--      from the current legacy `status` per §6.1.
--   2. decision_state normalization — the ratified human axis (§1.2) is
--      needs_review|mitigating|accepted_risk|resolved. The 20260829 backfill
--      introduced 'in_progress' decision rows (pre-ratification drift);
--      normalize them to 'mitigating' (work accepted / underway) and tighten
--      the CHECK to the canonical set.
--   3. finding_lifecycle_events — the append-only per-finding lifecycle event
--      stream (§6.2), mirroring risk_lifecycle_events exactly: written in the
--      SAME tenant transaction as the state change (deliberate improvement
--      over the fire-and-forget security_audit_log projection), immutability
--      triggers, RLS from creation (NOT FORCE — inert until app_request flip).
--
-- Legacy `status` is NOT touched (§6.3 — the derived projection is a later
-- reader-migration package). No destructive change to findings rows beyond
-- the decision_state normalization mandated by the ratified value set.
--
-- Additive; idempotent; safe to re-run. Reversible:
--   ALTER TABLE findings DROP COLUMN IF EXISTS operational_status;
--   DROP TABLE IF EXISTS finding_lifecycle_events;
--   (decision_state CHECK can be restored from 20260829.)
-- ============================================================

-- 1. Operational axis (system-derived; never hand-set) ----------------------

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'findings_operational_status_check'
  ) THEN
    ALTER TABLE findings
      ADD CONSTRAINT findings_operational_status_check
      CHECK (operational_status IN ('open', 'in_progress', 'remediated'));
  END IF;
END $$;

-- Backfill from the legacy status (spec §6.1). Only rows still at the column
-- default are touched (same one-time-idempotent pattern as 20260829).
UPDATE findings SET operational_status =
  CASE
    WHEN status = 'in_progress'                          THEN 'in_progress'
    WHEN status IN ('closed', 'accepted', 'resolved')    THEN 'remediated'
    ELSE 'open'
  END
WHERE operational_status = 'open';

CREATE INDEX IF NOT EXISTS idx_findings_org_operational
  ON findings (organization_id, operational_status);

-- Cascade lookup: the child→parent recompute (spec §5) reads all Actions of a
-- finding by (org, source_type, source_id).
CREATE INDEX IF NOT EXISTS idx_actions_org_source
  ON actions (organization_id, source_type, source_id);

-- 2. Decision axis normalization to the ratified set (spec §1.2) ------------

UPDATE findings SET decision_state = 'mitigating' WHERE decision_state = 'in_progress';

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_decision_state_check;
ALTER TABLE findings
  ADD CONSTRAINT findings_decision_state_check
  CHECK (decision_state IN ('needs_review', 'accepted_risk', 'mitigating', 'resolved'));

-- 3. Append-only lifecycle event stream (spec §6.2) -------------------------

CREATE TABLE IF NOT EXISTS finding_lifecycle_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  finding_id       UUID        NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  axis             TEXT        NOT NULL,
  from_state       TEXT        NULL,
  to_state         TEXT        NOT NULL,
  transition       TEXT        NOT NULL,
  actor_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_api_key_id UUID        NULL,
  comment          TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT finding_lifecycle_event_axis_check CHECK (axis IN ('operational', 'decision')),
  CONSTRAINT finding_lifecycle_event_transition_check CHECK (
    transition IN (
      'operational_advanced', 'operational_remediated', 'operational_recomputed',
      'accept_plan', 'accept_risk', 'close', 'reopen'
    )
  ),
  CONSTRAINT finding_lifecycle_event_states_check CHECK (
    (axis = 'operational' AND to_state IN ('open', 'in_progress', 'remediated'))
    OR
    (axis = 'decision' AND to_state IN ('needs_review', 'mitigating', 'accepted_risk', 'resolved'))
  )
);

CREATE INDEX IF NOT EXISTS idx_fle_org_finding_created
  ON finding_lifecycle_events (organization_id, finding_id, created_at DESC, id DESC);

-- Append-only at the database level (same pattern as risk_lifecycle_events /
-- security_audit_log): UPDATE/DELETE/TRUNCATE are forbidden; INSERT remains.
CREATE OR REPLACE FUNCTION finding_lifecycle_events_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'finding_lifecycle_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_finding_lifecycle_events_row_mutation ON finding_lifecycle_events;
CREATE TRIGGER prevent_finding_lifecycle_events_row_mutation
  BEFORE UPDATE OR DELETE ON finding_lifecycle_events
  FOR EACH ROW
  EXECUTE FUNCTION finding_lifecycle_events_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_finding_lifecycle_events_truncate ON finding_lifecycle_events;
CREATE TRIGGER prevent_finding_lifecycle_events_truncate
  BEFORE TRUNCATE ON finding_lifecycle_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION finding_lifecycle_events_forbid_mutation();

-- RLS from creation (NOT FORCE — inert until the app_request flip).
ALTER TABLE finding_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finding_lifecycle_events_tenant_isolation ON finding_lifecycle_events;
CREATE POLICY finding_lifecycle_events_tenant_isolation ON finding_lifecycle_events
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Tier B: append-only stream — SELECT + INSERT only (no UPDATE/DELETE grant).
GRANT SELECT, INSERT ON finding_lifecycle_events TO app_request;
