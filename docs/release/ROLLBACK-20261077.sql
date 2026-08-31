-- ROLLBACK for 20261077_assurance_exception_effect.sql
--
-- Purely additive: two new tables, their indexes, RLS policies, grants, and one
-- trigger function that exists only for these tables.
--
-- ⚠ PARTLY DESTRUCTIVE. The exception rows and their control links are
-- re-materializable from the extraction. The `governed_effect` interpretations
-- are NOT: they are human governance determinations and nothing can recompute
-- them. Take a copy BEFORE rolling back:
--
--   CREATE TABLE vendor_assurance_exceptions_backup_20261077 AS
--     SELECT * FROM vendor_assurance_exceptions;
--   CREATE TABLE vendor_assurance_exception_controls_backup_20261077 AS
--     SELECT * FROM vendor_assurance_exception_controls;
--
-- Order matters: the link table references the exception table.

DROP TABLE IF EXISTS vendor_assurance_exception_controls;
DROP TABLE IF EXISTS vendor_assurance_exceptions;
DROP FUNCTION IF EXISTS vendor_assurance_require_human_exception_effect();
