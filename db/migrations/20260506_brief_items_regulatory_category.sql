-- 20260506_brief_items_regulatory_category.sql
--
-- Adds 'regulatory' to the intelligence_brief_items category CHECK constraint.
--
-- Context:
--   The brief generator's BriefCategory type is extended with a new 'regulatory'
--   bucket to hold signals of type 'regulatory_change' (NIST, FTC, and similar
--   authoritative feeds). The existing CHECK constraint
--   ('vulnerability', 'threat_actor', 'vendor_incident', 'general') must be
--   widened to allow 'regulatory' items to be inserted.
--
-- PostgreSQL CHECK constraints cannot be altered in-place; the constraint must
-- be dropped and re-added.

ALTER TABLE intelligence_brief_items
  DROP CONSTRAINT IF EXISTS intelligence_brief_items_category_check;

ALTER TABLE intelligence_brief_items
  ADD CONSTRAINT intelligence_brief_items_category_check
  CHECK (category IN (
    'vulnerability',
    'threat_actor',
    'vendor_incident',
    'regulatory',
    'general'
  ));
