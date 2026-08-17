-- Migration: org_capability_gates
-- Package: E-3 — per-organization capability gates for the env-global flags
--          (C9 Part 3, "BUILD BEFORE LAUNCH"; sequenced before Stage-2 activation)
--
-- THE PROBLEM. Every Ask/agentic flag is environment-global (promotion audit §4):
-- a flip is all-tenants-at-once, a property that gets strictly worse with each
-- customer, and a gate retrofitted after activation means turning capabilities
-- OFF for live users. This table adds the per-org dimension so a capability can
-- be piloted for one design partner before any global activation.
--
-- WHY A TABLE, not more organizations columns (the enterprise_context_capability
-- / core_platform_capability precedent):
--   1. Granting a tenant an agentic capability is a GOVERNANCE act — it needs
--      granted_by / reason / timestamps, which a bare BOOLEAN column cannot carry.
--   2. One migration covers every current and future capability key (TDG-15:
--      new keys must not require a migration — `capability` is deliberately NOT
--      CHECK-constrained; the code registry in orgCapabilityGates.ts is the
--      authority and the resolver fails CLOSED on unregistered keys).
--   3. E-2 interlock by construction: organization_id + ON DELETE CASCADE means
--      erasure_inventory() discovers this table automatically (it scans
--      information_schema for org-scoped tables) and an org erasure removes the
--      rows without this table ever joining a grant list.
--
-- RESOLUTION MODEL (enforced in code, recorded here for the reader):
--   effective = envFlag(capability) AND orgGate(org, capability)
--   orgGate consulted ONLY when SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED=true
--   (default off -> resolver returns allow with ZERO queries; byte-identical
--   behaviour to today, the same rollout shape as the P9 dual-gate).
--   Row present  -> row.enabled decides.
--   Row absent   -> the capability's registry default decides (live capabilities
--                   default allow; dark agentic capabilities default deny, so
--                   Stage-2 activation reaches ONLY granted orgs).
--   Lookup error -> DENY. A resolver fault is an entitlement fault.
--
-- Additive only; no data touched; no existing behaviour changes while the
-- master flag is off. Rollback (manual, forward-only convention):
--   DROP TABLE organization_capabilities;

CREATE TABLE IF NOT EXISTS organization_capabilities (
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Registry key (e.g. 'ask_actions'). NOT a CHECK list — see TDG-15 note above.
  capability      TEXT        NOT NULL,

  enabled         BOOLEAN     NOT NULL,

  -- Who granted/revoked and why. Nullable with SET NULL rather than RESTRICT:
  -- RESTRICT would enrol this table in the D-12 cascade web that made tenant
  -- erasure impossible (the E-2 design's own lesson).
  granted_by      UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT        NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, capability)
);

COMMENT ON TABLE organization_capabilities IS
  'E-3: per-org gates for env-global capability flags. Effective state is '
  'envFlag AND orgGate; the code registry (orgCapabilityGates.ts) is the '
  'authority on valid capability keys and per-key defaults.';
COMMENT ON COLUMN organization_capabilities.capability IS
  'Registry key. Unregistered keys fail closed in the resolver; no CHECK list '
  'so new capabilities never need a migration (TDG-15).';

-- Tenant isolation: same policy shape as ask_proposed_actions. INERT until the
-- app_request role flip (M-1), carried as defense-in-depth like every other
-- RLS-bearing table.
ALTER TABLE organization_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_capabilities_tenant_isolation ON organization_capabilities
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON organization_capabilities TO app_request;
