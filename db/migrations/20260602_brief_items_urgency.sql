-- 20260602_brief_items_urgency.sql
--
-- Adds per-item urgency classification to intelligence_brief_items.
--
-- Context:
--   The brief redesign (PR D1) reframes each signal around a time-horizon
--   priority band — "when do I act" — rather than a brief-level editorial
--   summary. The classification rubric lives in the enrichment prompt
--   (intelligenceBriefGenerator.ts):
--
--     immediate  — act this week  (KEV / active exploitation / federal
--                                   deadline / CVSS 9+ with public PoC)
--     near_term  — act this month (critical-high vulns with patches,
--                                   exploitation likely, near-term reg
--                                   deadlines)
--     far_term   — monitor        (emerging patterns, advisories,
--                                   longer-horizon shifts)
--
--   NULL means the enrichment step ran before this column existed, or
--   the LLM call failed and no fallback default was applied. The frontend
--   (PR D2) treats NULL as "Unclassified".
--
-- Rationale for TEXT + CHECK over a postgres enum:
--   Matches the existing convention on this table (status, category,
--   relevance are all text + CHECK). Enums require ALTER TYPE to add
--   values, which doesn't compose well with multi-environment rollout.
--
-- The CHECK is written `urgency IS NULL OR urgency IN (...)` rather than
-- relying on NULL's three-valued-logic pass-through, so the constraint
-- reads explicitly as "NULL is allowed, plus these three values."

ALTER TABLE intelligence_brief_items
  ADD COLUMN IF NOT EXISTS urgency TEXT;

ALTER TABLE intelligence_brief_items
  DROP CONSTRAINT IF EXISTS intelligence_brief_items_urgency_check;

ALTER TABLE intelligence_brief_items
  ADD CONSTRAINT intelligence_brief_items_urgency_check
  CHECK (urgency IS NULL OR urgency IN (
    'immediate',
    'near_term',
    'far_term'
  ));

-- Partial index — used by the frontend to render items grouped by urgency
-- band. NULL rows (legacy briefs) are excluded; they don't participate in
-- the grouped view.
CREATE INDEX IF NOT EXISTS idx_brief_items_brief_urgency
  ON intelligence_brief_items (brief_id, urgency)
  WHERE urgency IS NOT NULL;
