-- Migration: applicability_assessments_seq
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 4c (persistence writer)
--
-- Adds a monotonic sequence column to applicability_assessments so the hash-chain
-- tail lookup is TIE-FREE even when multiple decisions are persisted in ONE tenant
-- transaction. `created_at DEFAULT NOW()` returns the TRANSACTION START time, so two
-- rows inserted in the same tx share an identical created_at; ordering the chain tail
-- by created_at then falls back to a random UUID and can select the wrong predecessor,
-- forking the chain (or tripping UNIQUE(organization_id, prev_hash)). A BIGSERIAL is
-- globally monotonic and increments per INSERT within a tx, giving an unambiguous
-- "latest row for this org" for the writer's prev_hash lookup.
--
-- Additive: ADD COLUMN on an empty table (no rows exist until the Slice 4c/4d writer
-- runs; the tables ship dark). BIGSERIAL implies NOT NULL DEFAULT nextval(...). The
-- WORM trigger blocks UPDATE/DELETE/TRUNCATE, not DDL, so ADD COLUMN is permitted.
-- Runs after 20260722 (the table) — lexical 27 > 22.

ALTER TABLE applicability_assessments
  ADD COLUMN IF NOT EXISTS seq BIGSERIAL;

-- Chain-tail lookup: newest row for an org by monotonic sequence.
CREATE INDEX IF NOT EXISTS idx_applicability_assessments_org_seq
  ON applicability_assessments (organization_id, seq DESC);
