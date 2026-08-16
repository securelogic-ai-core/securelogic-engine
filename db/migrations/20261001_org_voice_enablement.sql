-- Migration: org_voice_enablement (ASK-C C-1, Launch Completion 4)
--
-- Per-tenant enablement for Ask voice input. The formalized voice gate
-- (docs/validation/ask-c-voice-gate.md) requires that an organization admin
-- can disable voice for their tenant and that the ENGINE refuses transcription
-- for a disabled tenant regardless of client behavior — a governance control,
-- not a UI preference.
--
-- DEFAULT true, deliberately: voice is live in production today with no
-- tenant-level switch, so a false default would silently remove shipped
-- behavior on migration (the same reasoning that makes the voice kill switch
-- default ON). Disablement is an admin's explicit act via
-- PATCH /api/org/settings, audited as org.settings_changed.
--
-- Consumed by attachOrganizationContext (request path, same SELECT as the
-- existing viewer_export_enabled grant — no added query) and by the
-- org-settings read/patch surface.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS voice_input_enabled BOOLEAN NOT NULL DEFAULT true;
