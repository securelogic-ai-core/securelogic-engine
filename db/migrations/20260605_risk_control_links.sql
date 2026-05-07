-- 20260605_risk_control_links.sql
--
-- RR-4 — Risk-to-control mapping (many-to-many).
--
-- Creates risk_control_links: explicit, user-driven, tenant-scoped linkage
-- between risks and controls. Mirrors the hardened template established by
-- signal_control_links / signal_obligation_links (May 2026 link-table standard):
--   * organization_id denormalized for hot-path indexes
--   * ON DELETE CASCADE on both entity FKs
--   * created_by_user_id with ON DELETE SET NULL preserves audit history
--   * deleted_at TIMESTAMPTZ NULL — soft delete; partial unique index excludes
--     soft-deleted rows so a previously-deleted link can be re-created
--
-- Use case: capture which controls mitigate which risks. Lets the platform
-- answer both "what controls reduce this risk?" (forward, on risk detail) and
-- "what risks does this control mitigate?" (inverse, on control detail) — the
-- core Bucket-A connective-tissue claim per docs/RISK_REGISTER_ROADMAP.md RR-4.
--
-- Modifies: nothing. Additive only. No alters to risks, controls, findings,
--           or any enum.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §1, §4, §8):
--   * link.organization_id is sourced from req.organizationContext, never
--     from the request body.
--   * risks.organization_id      MUST equal link.organization_id.
--   * controls.organization_id   MUST equal link.organization_id.
--   * Cross-org probes return 404 (not 403) — no enumeration.
--
-- Idempotent re-link semantics (RR-4 spec, stricter than signal_*_links):
--   * Live row already exists → return 200, no audit, no-op.
--   * Soft-deleted row exists → undelete in place (UPDATE deleted_at = NULL,
--     refresh note, created_by_user_id, created_at), emit .created.
--   * Else INSERT and emit .created.
--   The undelete-in-place path is a deliberate enhancement over the
--   signal_*_links convention (which leaves orphaned soft-deleted rows on
--   re-link). Keeps one history row per (org, risk, control) pair.

CREATE TABLE IF NOT EXISTS risk_control_links (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_id            UUID         NOT NULL REFERENCES risks(id)         ON DELETE CASCADE,
  control_id         UUID         NOT NULL REFERENCES controls(id)      ON DELETE CASCADE,
  note               TEXT         NULL,
  created_by_user_id UUID         NULL     REFERENCES users(id)         ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);

-- One active link per (org, risk, control). Soft-deleted rows are excluded so
-- the undelete-in-place path can locate them (and so a brand-new INSERT after
-- a soft delete would not collide if we ever bypassed the undelete path).
CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_control_links_unique_active
  ON risk_control_links (organization_id, risk_id, control_id)
  WHERE deleted_at IS NULL;

-- Hot read: list controls linked to a risk (forward direction, used by the
-- "Mitigating Controls" section on the risk detail page).
CREATE INDEX IF NOT EXISTS idx_risk_control_links_org_risk
  ON risk_control_links (organization_id, risk_id)
  WHERE deleted_at IS NULL;

-- Hot read: list risks mitigated by a control (inverse direction, used by the
-- "Risks Mitigated" sidebar card on the control detail page).
CREATE INDEX IF NOT EXISTS idx_risk_control_links_org_control
  ON risk_control_links (organization_id, control_id)
  WHERE deleted_at IS NULL;
