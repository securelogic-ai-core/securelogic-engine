-- Migration: signal_ai_system_links
-- Package: signal-to-AI-system-linkage
--
-- Creates:
--   signal_ai_system_links — explicit, user-driven, tenant-scoped linkage
--                            between cyber_signals and ai_systems. Continues
--                            the signal-to-platform-linkage pattern proven by
--                            signal-to-vendor-linkage (BUILD_SEQUENCE.md
--                            Priority 5). Schema mirrors signal_vendor_links
--                            exactly, with ai_system_id replacing vendor_id.
--
--   Use case: link a MITRE ATLAS or other AI-targeting threat signal to the
--   specific deployed AI systems in an organization that the signal applies
--   to. Enables read-back in both directions for downstream surfaces.
--
-- Modifies: nothing. Additive only. No alters to cyber_signals, ai_systems,
--           findings, risks, or any enum.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §4):
--   - link.organization_id is sourced from req.organizationContext, never
--     from the request body.
--   - ai_systems.organization_id MUST equal link.organization_id.
--   - cyber_signals.organization_id MUST equal link.organization_id OR
--     be NULL (global, public-source signals are explicitly cross-org-
--     visible per the standard §1). The cross-row pre-flight on the
--     route handles this asymmetry — same as signal_vendor_links.
--
-- Soft delete: deleted_at IS NULL identifies live links. The unique
--              constraint is partial on deleted_at IS NULL so a deleted
--              link can be re-created without uniqueness collision.

CREATE TABLE IF NOT EXISTS signal_ai_system_links (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_id          UUID         NOT NULL REFERENCES cyber_signals(id) ON DELETE CASCADE,
  ai_system_id       UUID         NOT NULL REFERENCES ai_systems(id)    ON DELETE CASCADE,
  note               TEXT         NULL,
  created_by_user_id UUID         NULL     REFERENCES users(id)         ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);

-- One active link per (org, signal, ai_system). Soft-deleted rows are excluded
-- so a previously-deleted link can be re-created.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_ai_system_links_unique_active
  ON signal_ai_system_links (organization_id, signal_id, ai_system_id)
  WHERE deleted_at IS NULL;

-- Hot read: list signals linked to an AI system.
CREATE INDEX IF NOT EXISTS idx_signal_ai_system_links_org_ai_system
  ON signal_ai_system_links (organization_id, ai_system_id)
  WHERE deleted_at IS NULL;

-- Hot read: list AI systems linked to a signal.
CREATE INDEX IF NOT EXISTS idx_signal_ai_system_links_org_signal
  ON signal_ai_system_links (organization_id, signal_id)
  WHERE deleted_at IS NULL;
