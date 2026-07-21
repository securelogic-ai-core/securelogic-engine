-- Migration: applicability_assessments
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 4b (persistence)
--
-- Creates the HEADER table of the applicability-decision record: the by-value,
-- immutable, hash-chained, reproducible decision an auditor/regulator/court reads
-- to answer "why did the platform conclude this signal applies to this org?".
--
-- Design authority: docs/architecture/enterprise-context/ENTERPRISE_CONTEXT_ARCHITECTURE.md
--   §7 AD-16 (defensible evidence: by-value + WORM + hash chain + reproducible) and
--   AD-7-revised (header carries reasoning_steps BY VALUE + narrative TEXT NULL).
--   The decision/confidence_band vocabularies are the single source of truth in
--   src/engine/applicability/v1/types.ts (APPLICABILITY_DECISIONS / CONFIDENCE_BANDS)
--   and are mirrored here as CHECK constraints — keep them in lockstep.
--
-- SLICE-4b RECONCILIATION of two ENTERPRISE_CONTEXT_ARCHITECTURE.md statements that
-- conflict with 4b's own constraints (recorded in the doc via S4b doc-sync):
--   1. NON-PARTITIONED. The doc's "partition at table creation" contradicts its own
--      S3.5 gate (a partitioning spike with load-test/EXPLAIN data BEFORE S4 writes).
--      Partitioning is a SCALE optimization, not an evidentiary property (the AR-8
--      Critical defensibility is by-value + WORM + hash chain + reproducibility, all
--      preserved here). The table is empty through 4b and until the 4c writer lands,
--      so the convert-while-empty window is preserved; the partition decision is
--      deferred to S3.5 completion. Zero partitioning precedent exists in the repo.
--   2. NO is_current COLUMN. A mutable is_current flag CANNOT coexist with WORM
--      (flipping a prior row true->false is an UPDATE the append-only trigger forbids).
--      "Current" is DERIVED: the newest row per (org, signal, target), served by the
--      latest-lookup index below. If that read ever profiles hot, the escape hatch is a
--      separate non-WORM pointer table upserted by the worker — never a mutable column
--      on this append-only record.
--
-- Immutability (WORM) is added in 20260725_applicability_worm.sql (trigger, fires
-- regardless of role — survives the eventual app_request/FORCE-RLS flip). Inert RLS
-- + app_request grant in 20260726_applicability_rls.sql.
--
-- Modifies: nothing. Additive only. Empty at birth — zero backfill risk. No writer
-- until Slice 4c; this slice ships the tables dark.

-- FK note: organization_id is NOT NULL ... ON DELETE CASCADE, mirroring the closest
-- immutable sibling risk_lifecycle_events (20260714). The theoretical CASCADE-delete
-- vs. WORM-trigger conflict on a HARD org delete is not exercised: the reaper is
-- tombstone-last (organizations rows are not hard-deleted), same as every other
-- immutable org-scoped table. Do not "fix" by dropping the FK — that would lose the
-- referential guarantee the rest of the schema relies on.
CREATE TABLE IF NOT EXISTS applicability_assessments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What the decision is about. signal_id / target_id have NO FK by design
  -- (polymorphic-by-query, matching signal_match_suggestions): the record must
  -- survive even if the referenced signal/target is later archived.
  signal_id        UUID        NOT NULL,
  target_type      TEXT        NOT NULL,
  target_id        UUID        NOT NULL,

  -- The decision (mirrors ApplicabilityResult).
  decision         TEXT        NOT NULL,
  confidence       SMALLINT    NOT NULL,
  confidence_band  TEXT        NOT NULL,

  -- Explainability substrate (AD-7-revised): the ordered deterministic rule trace,
  -- BY VALUE. JSONB is correct here — this is a narration trace, not a canonical
  -- domain object (the queryable parts are the normalized child tables).
  reasoning_steps  JSONB       NOT NULL,
  -- Optional per-org LLM rendering of the structured reasoning (never the source).
  narrative        TEXT        NULL,

  -- Reproducibility pins (AD-7-support): the corpus + shape that produced this.
  engine_version   TEXT        NOT NULL,
  schema_version   TEXT        NOT NULL,

  -- Tamper-evidence hash chain (AD-16). content_hash = sha256(canonical | prev_hash);
  -- prev_hash links the org's decision sequence (GENESIS = 64 zeros for the first).
  content_hash     TEXT        NOT NULL,
  prev_hash        TEXT        NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT applicability_assessments_target_type_chk
    CHECK (target_type IN ('vendor', 'ai_system', 'control', 'obligation')),
  CONSTRAINT applicability_assessments_decision_chk
    CHECK (decision IN (
      'affected', 'potentially_affected', 'not_affected', 'needs_review', 'unknown'
    )),
  CONSTRAINT applicability_assessments_confidence_chk
    CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT applicability_assessments_confidence_band_chk
    CHECK (confidence_band IN ('low', 'medium', 'high'))
);

-- Fork-proof the hash chain: each hash may be the predecessor of at most one row
-- per org, so a concurrent double-insert that reads the same prev_hash loses the
-- race (unique violation) instead of forking the chain. The 4c writer adds a
-- per-org advisory lock on top; this constraint is the durable backstop.
CREATE UNIQUE INDEX IF NOT EXISTS idx_applicability_assessments_org_prev_hash
  ON applicability_assessments (organization_id, prev_hash);

-- Derived "latest": newest decision per (org, signal, target). Replaces a mutable
-- is_current column (which WORM forbids).
CREATE INDEX IF NOT EXISTS idx_applicability_assessments_latest
  ON applicability_assessments (organization_id, signal_id, target_type, target_id, created_at DESC);

-- Hot read: an org's decisions, newest first.
CREATE INDEX IF NOT EXISTS idx_applicability_assessments_org_created
  ON applicability_assessments (organization_id, created_at DESC);
