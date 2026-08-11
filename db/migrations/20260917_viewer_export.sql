-- 20260917_viewer_export.sql
-- Enterprise seat program — Phase 6: export is a separately grantable
-- permission. Reading a register on screen is not the same act as downloading
-- it; bulk export is the primary exfiltration path.
--
-- Viewer-class identities do NOT get export by reading — an org must opt in.
-- Default FALSE. Full-governance identities always have export:data (resolved
-- in seatScope.ts); this column only affects Viewers. Additive, and consulted
-- only when the seat model is enabled.
--
-- Rollback (manual, forward-only):
--   ALTER TABLE organizations DROP COLUMN viewer_export_enabled;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS viewer_export_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN organizations.viewer_export_enabled IS
  'Per-org grant: may Viewer-class identities bulk-export? Default false — read access never implies export. Full/admin always may; Contributors never (their exports are scoped, Phase 6+).';
