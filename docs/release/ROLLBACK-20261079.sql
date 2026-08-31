-- Rollback for 20261079 (VA-S4-4C-4 sufficiency determination).
--
-- DESTRUCTIVE: drops every recorded sufficiency determination. Each row is a
-- human decision, so export before running this if the history matters.
--
--   SELECT * FROM vendor_requirement_sufficiency_determinations;
--
-- Nothing else reads this table (4C-4 ships unwired), so the drop has no
-- dependents.
DROP TRIGGER IF EXISTS trg_vendor_assurance_require_human_determiner
  ON vendor_requirement_sufficiency_determinations;
DROP TABLE IF EXISTS vendor_requirement_sufficiency_determinations;
DROP FUNCTION IF EXISTS vendor_assurance_require_human_determiner();
