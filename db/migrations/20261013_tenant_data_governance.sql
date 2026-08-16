-- Migration: tenant_data_governance
-- Package:   E-1 — Tenant Data Governance (TDG), the platform retention primitive
--
-- TDG governs DATA CLASSES, not features. `ask_conversation` is the first
-- registered class; `jobs`, `data_export_files` and `email_provider_events` are
-- expected to follow WITHOUT a schema change (invariant TDG-15). Nothing here
-- names Ask: the class key is a value in a column, and the per-class behaviour
-- (which tables, which age column, which bounds) lives in the code registry.
--
-- Two tables:
--
--   retention_policies   append-only, VERSIONED tenant overrides
--   legal_holds          append-plus-release holds that outrank every deletion
--
-- ── retention_policies: absence is a meaningful state ───────────────────────
--
-- No row means "the platform default for this class" (TDG-2). That is why
-- `source` cannot be 'platform_default': the default is not storable, so it can
-- never drift from the registry, and the schema arrives needing NO backfill for
-- every existing org to be governed.
--
-- The table is APPEND-ONLY and versioned (TDG-8). A change inserts a new
-- version; nothing is ever updated in place. The effective policy is the
-- highest version with effective_from <= now(). Every deletion records the
-- policy_version_id it acted under, so a later change cannot retroactively
-- re-explain a past deletion — which is exactly what "policy changes cannot
-- silently rewrite historical deletion decisions" has to mean if it is to be
-- provable rather than promised.
--
-- Clearing an override is also an INSERT (`cleared = true`, retention_days
-- NULL), so reverting to the platform default is itself a versioned, audited
-- act rather than the erasure of one.
--
-- ── legal_holds: the only thing that outranks a policy ──────────────────────
--
-- A hold suppresses automated expiry, administrator deletion AND owner deletion
-- alike (TDG-6). Enforcement lives inside the single delete path, never in its
-- callers.
--
-- Separation of duties (TDG-7) follows riskApprovals exactly: authority is a
-- pure code seam, the route returns 409 sod_violation, and the database carries
-- the belt-and-braces CHECK that a hold cannot be released by whoever placed it.
--
-- Actor columns are nullable with ON DELETE SET NULL rather than NOT NULL with
-- RESTRICT. RESTRICT would enrol these tables in the D-12 cascade web that makes
-- tenant erasure impossible, which is precisely the class of problem this
-- programme exists to stop creating. Durable attribution lives where it belongs:
-- in the immutable security_audit_log event written for every transition, whose
-- organization_id is ON DELETE SET NULL and therefore survives the erasure it
-- describes.
--
-- ADDITIVE ONLY. Two new tables, empty at birth. Nothing existing is altered,
-- so no Ask conversation changes state because this migration arrived.

-- ---------------------------------------------------------------
-- retention_policies
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS retention_policies (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Registry key (e.g. 'ask_conversation'). Deliberately NOT a CHECK list: new
  -- governed classes must not require a migration (TDG-15). The registry is the
  -- authority on which keys are valid, and the write path validates against it.
  data_class         TEXT        NOT NULL,

  -- Monotonic per (organization, class). UNIQUE below makes concurrent writers
  -- collide rather than silently interleave versions.
  version            INTEGER     NOT NULL CHECK (version > 0),

  -- NULL only when this version CLEARS the override back to the platform
  -- default. Bounds are per-class and enforced in code against the registry;
  -- the only DB-level rule is that a retained value is a positive whole number
  -- of days.
  retention_days     INTEGER     NULL CHECK (retention_days IS NULL OR retention_days > 0),
  cleared            BOOLEAN     NOT NULL DEFAULT FALSE,

  -- 'platform_default' is intentionally NOT a legal value: the default is the
  -- ABSENCE of a row, so it cannot be written, stale or divergent.
  source             TEXT        NOT NULL CHECK (source IN ('tenant', 'contract')),

  set_by_user_id     UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  reason             TEXT        NULL,

  effective_from     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT retention_policies_version_unique
    UNIQUE (organization_id, data_class, version),

  -- A version either sets a value or clears it. Never both, never neither.
  CONSTRAINT retention_policies_cleared_shape CHECK (
    (cleared AND retention_days IS NULL) OR (NOT cleared AND retention_days IS NOT NULL)
  )
);

-- The resolver's only query: newest effective version for (org, class).
CREATE INDEX IF NOT EXISTS idx_retention_policies_effective
  ON retention_policies (organization_id, data_class, effective_from DESC, version DESC);

COMMENT ON TABLE retention_policies IS
  'Append-only, versioned tenant retention overrides, keyed by data class. No '
  'row means the platform default for that class — the default is deliberately '
  'not storable. Every deletion records the policy version it acted under, so '
  'policy history cannot be rewritten to re-explain a past deletion.';

-- ---------------------------------------------------------------
-- legal_holds
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS legal_holds (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Four scopes, widest to narrowest. 'organization' holds everything the org
  -- owns in every governed class; 'object' holds one row of one class.
  scope_type           TEXT        NOT NULL
                         CHECK (scope_type IN ('organization', 'data_class', 'subject_user', 'object')),
  data_class           TEXT        NULL,
  subject_user_id      UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  object_id            UUID        NULL,

  reason               TEXT        NOT NULL,

  status               TEXT        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'released')),

  placed_by_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  placed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  released_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  released_at          TIMESTAMPTZ NULL,
  release_reason       TEXT        NULL,

  -- Each scope carries exactly the discriminators it needs and no others, so a
  -- malformed hold cannot silently match nothing (or everything).
  CONSTRAINT legal_holds_scope_shape CHECK (
    (scope_type = 'organization' AND data_class IS NULL     AND subject_user_id IS NULL AND object_id IS NULL)
    OR (scope_type = 'data_class'   AND data_class IS NOT NULL AND subject_user_id IS NULL AND object_id IS NULL)
    OR (scope_type = 'subject_user' AND subject_user_id IS NOT NULL AND object_id IS NULL)
    OR (scope_type = 'object'       AND data_class IS NOT NULL AND object_id IS NOT NULL)
  ),

  -- A release is complete or it has not happened.
  CONSTRAINT legal_holds_release_shape CHECK (
    (status = 'active'   AND released_at IS NULL AND release_reason IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  ),

  -- TDG-7, belt to the route's braces: whoever placed a hold cannot release it.
  -- The NULL guards keep the constraint valid after an actor FK is SET NULL.
  CONSTRAINT legal_holds_sod CHECK (
    released_by_user_id IS NULL
    OR placed_by_user_id IS NULL
    OR released_by_user_id <> placed_by_user_id
  )
);

-- The hold predicate runs on every deletion, so it must be cheap: active holds
-- for an org, narrowed by scope in the query.
CREATE INDEX IF NOT EXISTS idx_legal_holds_active
  ON legal_holds (organization_id, scope_type, data_class)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_legal_holds_active_object
  ON legal_holds (organization_id, object_id)
  WHERE status = 'active' AND object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legal_holds_active_subject
  ON legal_holds (organization_id, subject_user_id)
  WHERE status = 'active' AND subject_user_id IS NOT NULL;

COMMENT ON TABLE legal_holds IS
  'Legal holds. An active hold suppresses automated expiry, administrator '
  'deletion and OWNER deletion alike. Append-plus-release at the database '
  'level: the only permitted UPDATE is the active -> released transition, and '
  'a hold can never be released by the user who placed it.';

-- ---------------------------------------------------------------
-- Immutability — same trigger discipline as security_audit_log (20260614)
-- and applicability_worm (20260725)
-- ---------------------------------------------------------------
--
-- WHY TRIGGERS, NOT GRANTS: a BEFORE trigger fires regardless of the connected
-- role, so these guarantees survive the eventual app_request/FORCE-RLS flip and
-- also bind anyone holding the Postgres password. RLS below is the orthogonal
-- tenant-scoping guarantee; the two compose.

CREATE OR REPLACE FUNCTION retention_policies_forbid_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'retention_policies is append-only (versioned): % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_retention_policies_row_mutation ON retention_policies;
CREATE TRIGGER prevent_retention_policies_row_mutation
  BEFORE UPDATE OR DELETE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION retention_policies_forbid_mutation();

DROP TRIGGER IF EXISTS prevent_retention_policies_truncate ON retention_policies;
CREATE TRIGGER prevent_retention_policies_truncate
  BEFORE TRUNCATE ON retention_policies
  FOR EACH STATEMENT EXECUTE FUNCTION retention_policies_forbid_mutation();

-- legal_holds is append-PLUS-RELEASE: one transition is permitted and every
-- other mutation raises. Enumerating the immutable columns is deliberate — a
-- blanket "forbid UPDATE" would make release impossible, and a blanket "allow
-- UPDATE" would let a hold's scope or reason be rewritten after the fact, which
-- is the same evidentiary failure the WORM tables exist to prevent.
CREATE OR REPLACE FUNCTION legal_holds_guard_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'legal_holds is append-plus-release: % is not permitted', TG_OP;
  END IF;

  IF OLD.status <> 'active' OR NEW.status <> 'released' THEN
    RAISE EXCEPTION 'legal_holds: only the active -> released transition is permitted (was % -> %)',
      OLD.status, NEW.status;
  END IF;

  IF NEW.id                <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.scope_type      <> OLD.scope_type
     OR NEW.reason          <> OLD.reason
     OR NEW.placed_at       <> OLD.placed_at
     OR NEW.data_class      IS DISTINCT FROM OLD.data_class
     OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
     OR NEW.object_id       IS DISTINCT FROM OLD.object_id
     OR NEW.placed_by_user_id IS DISTINCT FROM OLD.placed_by_user_id
  THEN
    RAISE EXCEPTION 'legal_holds: a release may not alter the hold it releases';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_legal_holds_row_mutation ON legal_holds;
CREATE TRIGGER guard_legal_holds_row_mutation
  BEFORE UPDATE OR DELETE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_guard_mutation();

DROP TRIGGER IF EXISTS guard_legal_holds_truncate ON legal_holds;
CREATE TRIGGER guard_legal_holds_truncate
  BEFORE TRUNCATE ON legal_holds
  FOR EACH STATEMENT EXECUTE FUNCTION legal_holds_guard_mutation();

-- ---------------------------------------------------------------
-- RLS — tenant scoping, landing with the tables
-- ---------------------------------------------------------------

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retention_policies_tenant_isolation ON retention_policies;
CREATE POLICY retention_policies_tenant_isolation ON retention_policies
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_holds_tenant_isolation ON legal_holds;
CREATE POLICY legal_holds_tenant_isolation ON legal_holds
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Defense in depth alongside the triggers: no DELETE privilege is granted on
-- either table, and retention_policies gets no UPDATE either.
GRANT SELECT, INSERT         ON retention_policies TO app_request;
GRANT SELECT, INSERT, UPDATE ON legal_holds        TO app_request;

-- TDG writes its audit events INSIDE the deletion transaction (TDG-12: a
-- deletion and its record cannot diverge), which means they travel on the
-- tenant channel rather than the elevated one auditLog.ts uses. The grant is
-- stated here so that path keeps working after the app_request flip; it is
-- idempotent and matches the Tier B posture auditLog.ts already documents.
GRANT SELECT, INSERT         ON security_audit_log TO app_request;
