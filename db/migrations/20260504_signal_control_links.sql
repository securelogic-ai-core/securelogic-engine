-- Migration: signal_control_links
-- Package: signal-to-control-linkage
--
-- Creates:
--   signal_control_links — explicit, user-driven, tenant-scoped linkage
--                          between cyber_signals and controls. Continues
--                          the signal-to-platform-linkage pattern proven by
--                          signal-to-vendor-linkage and signal-to-AI-system-
--                          linkage (BUILD_SEQUENCE.md Priority 5). Schema
--                          mirrors signal_vendor_links / signal_ai_system_links
--                          exactly, with control_id replacing vendor_id /
--                          ai_system_id.
--
--   Use case: link an external signal to the specific internal control(s)
--   the signal exercises or stresses (e.g., a CISA advisory about MFA bypass
--   linked to the org's MFA control; a regulatory change linked to the
--   affected internal control).
--
-- Modifies: nothing. Additive only. No alters to cyber_signals, controls,
--           findings, risks, or any enum.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §4):
--   - link.organization_id is sourced from req.organizationContext, never
--     from the request body.
--   - controls.organization_id MUST equal link.organization_id.
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

CREATE TABLE IF NOT EXISTS signal_control_links (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_id          UUID         NOT NULL REFERENCES cyber_signals(id) ON DELETE CASCADE,
  control_id         UUID         NOT NULL REFERENCES controls(id)      ON DELETE CASCADE,
  note               TEXT         NULL,
  created_by_user_id UUID         NULL     REFERENCES users(id)         ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);

-- One active link per (org, signal, control). Soft-deleted rows are excluded
-- so a previously-deleted link can be re-created. This is also the inference
-- target for ON CONFLICT in the POST handler.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_control_links_unique_active
  ON signal_control_links (organization_id, signal_id, control_id)
  WHERE deleted_at IS NULL;

-- Hot read: list signals linked to a control.
CREATE INDEX IF NOT EXISTS idx_signal_control_links_org_control
  ON signal_control_links (organization_id, control_id)
  WHERE deleted_at IS NULL;

-- Hot read: list controls linked to a signal.
CREATE INDEX IF NOT EXISTS idx_signal_control_links_org_signal
  ON signal_control_links (organization_id, signal_id)
  WHERE deleted_at IS NULL;
