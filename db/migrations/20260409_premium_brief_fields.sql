-- Premium Intelligence Brief fields
--
-- Adds three new editorial columns to newsletter_issues:
--
--   thesis_headline      — one-sentence declarative theme statement for the issue
--                          (different from title, which is a generic weekly label)
--   cross_domain_analysis — LLM-generated analysis of patterns that connect signals
--                           across risk categories; NULL if no meaningful pattern exists
--   action_summary_json  — structured three-list action plan derived from all signals:
--                          { thisWeek: string[], thisMonth: string[], monitor: string[] }
--
-- All columns are nullable. Existing rows will have NULL values, which the
-- rendering layer treats as absent sections (not errors).

ALTER TABLE newsletter_issues
  ADD COLUMN IF NOT EXISTS thesis_headline TEXT,
  ADD COLUMN IF NOT EXISTS cross_domain_analysis TEXT,
  ADD COLUMN IF NOT EXISTS action_summary_json JSONB;
