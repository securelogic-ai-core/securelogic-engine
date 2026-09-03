-- ROLLBACK for 20261072_tested_control_review_grain (S4-4C-0).
--
-- DATA LOSS: drops every ELEMENT-grain review decision's key and snapshot.
-- Whole-field decisions (element_key IS NULL) are untouched and keep working —
-- they are the legacy shape. Snapshot first if any element decisions exist:
--   COPY (SELECT id, organization_id, extraction_id, field_name, element_key,
--                element_snapshot, decision, reviewed_value, reviewer_note,
--                decided_by_user_id, decided_at
--           FROM vendor_assurance_review_decisions WHERE element_key IS NOT NULL)
--     TO '/tmp/element_review_decisions.csv' CSV HEADER;
--
-- NOTE: rolling this back WITHOUT also reverting the application half leaves
-- the approval gate asking for element decisions it can no longer record.
-- Revert both together.
--
-- ORDER: constraints before columns — they reference the columns.
-- Idempotent.

ALTER TABLE vendor_assurance_review_decisions
  DROP CONSTRAINT IF EXISTS vendor_assurance_review_decisions_element_snapshot_check;
ALTER TABLE vendor_assurance_review_decisions
  DROP CONSTRAINT IF EXISTS vendor_assurance_review_decisions_element_scope_check;

DROP INDEX IF EXISTS idx_vendor_assurance_review_decisions_element_projection;

ALTER TABLE vendor_assurance_review_decisions
  DROP COLUMN IF EXISTS element_snapshot,
  DROP COLUMN IF EXISTS element_key;
