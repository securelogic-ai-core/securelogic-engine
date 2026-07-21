-- Migration: applicability_evidence
-- Package: Enterprise Context Layer (ECL) — Priority-5 Slice 4b (persistence)
--
-- The BY-VALUE evidence snapshots for an applicability decision (AD-16 #1). Each row
-- captures the value of an input AT DECISION TIME alongside a pointer to its source,
-- so "re-derive the 2026 decision" resolves to the 2026 values — not today's mutated
-- rows. Typed + indexed so audit queries ("every decision that used vendor X") are
-- answerable at query time, unlike a JSONB blob.
--
-- Denormalized organization_id (Tradeoff B1, same as enterprise_data_stores): the
-- child carries its own organization_id so it gets the identical NULLIF RLS policy
-- rather than an EXISTS-parent policy. MUST equal the parent's organization_id
-- (enforced at the write path in Slice 4c).
--
-- captured_value is JSONB (the by-value snapshot may be a scalar or a small object).
-- This is NOT a canonical-object-as-blob: it is a frozen historical VALUE, not a
-- live domain entity. WORM + inert RLS added in the worm/rls migrations.
--
-- Additive only. Empty at birth. No writer until Slice 4c.

CREATE TABLE IF NOT EXISTS applicability_evidence (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    UUID        NOT NULL REFERENCES applicability_assessments(id) ON DELETE CASCADE,
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What kind of input this is (e.g. 'match_candidate', 'graph_edge', 'entity_attr').
  evidence_type    TEXT        NOT NULL,
  -- Where it came from (polymorphic-by-query; ref_id has no FK, by design, so the
  -- snapshot survives archival of the source row).
  ref_table        TEXT        NOT NULL,
  ref_id           UUID        NULL,

  -- The value at decision time (the reproducibility payload).
  captured_value   JSONB       NOT NULL,
  -- Optional contribution weight of this evidence to the decision.
  weight           NUMERIC     NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit query: "every decision whose evidence referenced <ref_table:ref_id>".
CREATE INDEX IF NOT EXISTS idx_applicability_evidence_ref
  ON applicability_evidence (organization_id, ref_table, ref_id);

-- Fetch all evidence for one assessment.
CREATE INDEX IF NOT EXISTS idx_applicability_evidence_assessment
  ON applicability_evidence (assessment_id);
