-- Migration: signal_obligation_links
-- Package: signal-to-obligation-linkage
--
-- Creates:
--   signal_obligation_links — explicit, user-driven, tenant-scoped linkage
--                             between cyber_signals and obligations. Fourth
--                             and final slice of BUILD_SEQUENCE.md Priority 5
--                             (signal-to-platform-linkage). Schema mirrors
--                             signal_vendor_links / signal_ai_system_links /
--                             signal_control_links exactly, with obligation_id
--                             replacing the prior FK target column.
--
--   Use case: link an external signal (e.g. a regulatory change, a CISA
--   advisory referencing a specific compliance regime, a sectoral threat
--   bulletin) to the org's specific compliance obligation(s) it affects.
--
-- Modifies: nothing. Additive only. No alters to cyber_signals, obligations,
--           findings, risks, or any enum.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §4):
--   - link.organization_id is sourced from req.organizationContext, never
--     from the request body.
--   - obligations.organization_id MUST equal link.organization_id.
--   - cyber_signals.organization_id MUST equal link.organization_id OR
--     be NULL (global, public-source signals are explicitly cross-org-
--     visible per the standard §1). The cross-row pre-flight on the
--     route handles this asymmetry — same as the prior link slices.
--
-- Soft delete: deleted_at IS NULL identifies live links. The unique
--              constraint is partial on deleted_at IS NULL so a deleted
--              link can be re-created without uniqueness collision.
--              The partial unique index is also the inference target for
--              ON CONFLICT in the route's atomic upsert.

CREATE TABLE IF NOT EXISTS signal_obligation_links (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_id          UUID         NOT NULL REFERENCES cyber_signals(id) ON DELETE CASCADE,
  obligation_id      UUID         NOT NULL REFERENCES obligations(id)   ON DELETE CASCADE,
  note               TEXT         NULL,
  created_by_user_id UUID         NULL     REFERENCES users(id)         ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);

-- One active link per (org, signal, obligation). Soft-deleted rows are excluded
-- so a previously-deleted link can be re-created. This is also the inference
-- target for ON CONFLICT in the POST handler.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_obligation_links_unique_active
  ON signal_obligation_links (organization_id, signal_id, obligation_id)
  WHERE deleted_at IS NULL;

-- Hot read: list signals linked to an obligation.
CREATE INDEX IF NOT EXISTS idx_signal_obligation_links_org_obligation
  ON signal_obligation_links (organization_id, obligation_id)
  WHERE deleted_at IS NULL;

-- Hot read: list obligations linked to a signal.
CREATE INDEX IF NOT EXISTS idx_signal_obligation_links_org_signal
  ON signal_obligation_links (organization_id, signal_id)
  WHERE deleted_at IS NULL;
