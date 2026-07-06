-- Migration: org_core_platform_capability
-- Package: Enterprise Asset Registry — P9 (Track C: gating dual-gate)
--
-- Adds the per-org override column for the `core_platform` capability — the
-- ADDITIVE half of gating unification (P6-P11-ROADMAP.md P9). The dual-gate
-- middleware (requirePremiumOrCorePlatform) admits an org when EITHER the
-- existing entitlement check passes (unchanged) OR this override is TRUE.
--
--   NULL  (default) — no explicit grant; the entitlement leg alone decides,
--                     exactly as today. Unlike enterprise_context_capability
--                     there is NO entitlement-based default on the capability
--                     leg: entitled orgs already pass the entitlement leg, so
--                     the capability leg exists purely to ADMIT additional
--                     orgs by explicit operator grant.
--   TRUE            — explicit per-org grant (admits regardless of tier).
--   FALSE           — explicit no-grant marker (same effect as NULL under the
--                     dual-gate; recorded for auditability).
--
-- The dual-gate itself is behind SECURELOGIC_CAPABILITY_GATING_ENABLED
-- (default off → the middleware delegates verbatim to requireEntitlement,
-- byte-identical responses). REMOVING the entitlement leg (the real cutover)
-- is a commercial decision and an explicit STOP GATE — not this migration,
-- not this flag.
--
-- Additive only; no data touched; no existing behavior changes.
-- Rollback (manual, forward-only convention): ALTER TABLE organizations
-- DROP COLUMN core_platform_capability.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS core_platform_capability BOOLEAN NULL;
