-- Migration: brief_items_personalization
-- Package: brief-pro-personalization
-- Depends on: intelligence_brief_pipeline (intelligence_brief_items)
--
-- Adds two columns to intelligence_brief_items that the personalization
-- pipeline writes after the enrichment step:
--
--   is_personalized  — TRUE when the item matched at least one platform entity
--                      (vendor, AI system, open risk, or obligation) for this org.
--                      Used by briefEmailSender.ts to honour the subscriber
--                      preference notify_vendor_matches_only.
--
--   platform_context — JSONB snapshot of what matched, stored for UI display and
--                      audit. Shape:
--                      {
--                        matched_vendors:     [{ id, name }],
--                        matched_risks:       [{ id, title }],
--                        matched_ai_systems:  [{ id, name }],
--                        matched_obligations: [{ id, title }]
--                      }
--                      NULL when is_personalized = FALSE or personalization
--                      was not run (briefs generated before this migration).

ALTER TABLE intelligence_brief_items
  ADD COLUMN IF NOT EXISTS is_personalized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS platform_context JSONB NULL;

-- Partial index — only personalized items need to be looked up by this flag.
CREATE INDEX IF NOT EXISTS idx_brief_items_personalized
  ON intelligence_brief_items (brief_id, is_personalized)
  WHERE is_personalized = TRUE;
