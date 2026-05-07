-- 20260606_risk_obligation_links.sql
--
-- RR-6 — Risk-to-obligation linkage (many-to-many).
--
-- Creates risk_obligation_links: explicit, user-driven, tenant-scoped linkage
-- between risks and obligations. Mechanical mirror of risk_control_links
-- (20260605) — same column shape, same indexes, same soft-delete pattern.
-- The token swap is control_id → obligation_id and table/index naming.
--
-- Use case: capture which compliance obligations a risk affects. Lets the
-- platform answer both "which obligations does this risk affect?" (forward,
-- on risk detail) and "which risks affect this obligation?" (inverse, on
-- obligation detail) — third leg of the connective-tissue triangle per
-- docs/RISK_REGISTER_ROADMAP.md RR-6.
--
-- Modifies: nothing. Additive only. No alters to risks, obligations, or any
--           enum.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §1, §4, §8):
--   * link.organization_id is sourced from req.organizationContext, never
--     from the request body.
--   * risks.organization_id        MUST equal link.organization_id.
--   * obligations.organization_id  MUST equal link.organization_id.
--   * Cross-org probes return 404 (not 403) — no enumeration.
--
-- Idempotent re-link semantics (matches RR-4):
--   * Live row already exists → return 200, no audit, no-op.
--   * Soft-deleted row exists → undelete in place (UPDATE deleted_at = NULL,
--     refresh note, created_by_user_id, created_at), emit .created.
--   * Else INSERT and emit .created.

CREATE TABLE IF NOT EXISTS risk_obligation_links (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_id            UUID         NOT NULL REFERENCES risks(id)         ON DELETE CASCADE,
  obligation_id      UUID         NOT NULL REFERENCES obligations(id)   ON DELETE CASCADE,
  note               TEXT         NULL,
  created_by_user_id UUID         NULL     REFERENCES users(id)         ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);

-- One active link per (org, risk, obligation). Soft-deleted rows are excluded
-- so the undelete-in-place path can locate them and so a brand-new INSERT
-- after a soft delete would not collide if we ever bypassed the undelete path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_obligation_links_unique_active
  ON risk_obligation_links (organization_id, risk_id, obligation_id)
  WHERE deleted_at IS NULL;

-- Hot read: list obligations linked to a risk (forward direction, used by
-- the "Affected Obligations" section on the risk detail page).
CREATE INDEX IF NOT EXISTS idx_risk_obligation_links_org_risk
  ON risk_obligation_links (organization_id, risk_id)
  WHERE deleted_at IS NULL;

-- Hot read: list risks affecting an obligation (inverse direction, used by
-- the "Risks Linked" sidebar card on the obligation detail page).
CREATE INDEX IF NOT EXISTS idx_risk_obligation_links_org_obligation
  ON risk_obligation_links (organization_id, obligation_id)
  WHERE deleted_at IS NULL;
