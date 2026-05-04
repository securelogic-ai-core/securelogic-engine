-- Migration: signal_vendor_links
-- Package: signal-to-vendor-linkage
--
-- Creates:
--   signal_vendor_links — explicit, user-driven, tenant-scoped linkage
--                         between cyber_signals and vendors. The narrowest
--                         high-value version of signal-to-platform linkage,
--                         intentionally vendor-only. Future packages will
--                         extend the same pattern to AI systems, controls,
--                         obligations, risks, and findings.
--
-- Modifies: nothing. Additive only. No alters to cyber_signals, vendors,
--           findings, risks, or any enum.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §4):
--   - link.organization_id is sourced from req.organizationContext, never
--     from the request body.
--   - vendors.organization_id MUST equal link.organization_id.
--   - cyber_signals.organization_id MUST equal link.organization_id OR
--     be NULL (global, public-source signals are explicitly cross-org-
--     visible per the standard §1).
--
-- Soft delete: deleted_at IS NULL identifies live links. The unique
--              constraint is partial on deleted_at IS NULL so a deleted
--              link can be re-created without uniqueness collision.

CREATE TABLE IF NOT EXISTS signal_vendor_links (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_id          UUID         NOT NULL REFERENCES cyber_signals(id) ON DELETE CASCADE,
  vendor_id          UUID         NOT NULL REFERENCES vendors(id)       ON DELETE CASCADE,
  note               TEXT         NULL,
  created_by_user_id UUID         NULL     REFERENCES users(id)         ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);

-- One active link per (org, signal, vendor). Soft-deleted rows are excluded
-- so a previously-deleted link can be re-created.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_vendor_links_unique_active
  ON signal_vendor_links (organization_id, signal_id, vendor_id)
  WHERE deleted_at IS NULL;

-- Hot read: list signals linked to a vendor.
CREATE INDEX IF NOT EXISTS idx_signal_vendor_links_org_vendor
  ON signal_vendor_links (organization_id, vendor_id)
  WHERE deleted_at IS NULL;

-- Hot read: list vendors linked to a signal.
CREATE INDEX IF NOT EXISTS idx_signal_vendor_links_org_signal
  ON signal_vendor_links (organization_id, signal_id)
  WHERE deleted_at IS NULL;
