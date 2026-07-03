-- Migration: org_max_enterprise_entities
-- Enterprise Context Layer (ECL) Slice 1 — per-org capacity cap for enterprise_entities.
--
-- A SEPARATE counter from max_monitored_entities. ECL entities (assets, applications,
-- business services, data stores, etc. — the new enterprise_entities table) do NOT count
-- toward max_monitored_entities and are NOT enforced by enforceEntityLimit. This column
-- backs a dedicated enterpriseEntityLimit counter enforced at the ECL write path only.
--
-- Decoupled by design (BUILD_SEQUENCE.md Priority-5 Slice-1, S0 decision 2026-07-03):
--   - does NOT touch max_monitored_entities or enforceEntityLimit or vendors/ai_systems
--   - the value is operator-tunable per org via UPDATE with NO DDL (§24 Q1 residual)
--
-- The DEFAULT below is a CONSERVATIVE placeholder for manual entry (Slice 1 has no CSV /
-- bulk import). The per-tier commercial value is an operator decision (§24 Q1); the
-- mechanism ships now, the value is tuned later without a schema change.
--
-- Adding a column with a constant default is metadata-only in modern Postgres — no table
-- rewrite, every existing row reads the default immediately, no null window. Mirrors
-- 20260623_org_max_monitored_entities.sql.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS max_enterprise_entities INTEGER NOT NULL DEFAULT 1000;
