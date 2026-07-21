-- Migration: org_enterprise_context_capability
-- Package: Enterprise Context Layer (ECL) — Priority-5 Item 9 (Enterprise gating)
--
-- GATE A ruling (2026-07-04, operator): access is CAPABILITY-BASED, not a hard-coded
-- tier check (AD-17). This per-org override column drives requireCapability("enterprise_context"):
--   - TRUE   -> granted for this org (regardless of tier)
--   - FALSE  -> denied for this org (regardless of tier)
--   - NULL   -> inherit the default: Platform plans (Platform Professional + Enterprise)
--              receive the capability by default; Brief tiers do not.
-- So Platform plans get ECL by default, and the operator can grant/revoke per org via a
-- single UPDATE (no code deploy). Production remains gated by the feature flag (off).
--
-- Additive; no new table; nullable so existing orgs inherit the default.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS enterprise_context_capability BOOLEAN NULL;
