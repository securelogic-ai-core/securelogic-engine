-- ROLLBACK for 20261088_core_assurance_composition.sql (Assessment Composition v1)
--
-- Additive migration: one canonical framework version row and one append-only
-- snapshot table. Code rollback (scope-rule 1.2.0 → 1.1.0) is what changes
-- behaviour; this only removes the schema the 1.2.0 code writes to.
--
-- DATA LOSS, stated plainly: the composition history (what SecureLogic
-- selected for each engagement and why) is discarded. The scope items and the
-- applicability record survive, so what was ASKED remains reproducible; what
-- was EXCLUDED and why does not. Take a copy first:
--
--   CREATE TABLE vendor_engagement_composition_snapshots_backup_20261088 AS
--     SELECT * FROM vendor_engagement_composition_snapshots;
--
-- The canonical framework version row is REFERENCED by any tenant
-- `frameworks` row provisioned with framework_key = 'securelogic-core-assurance'
-- (RESTRICT) and by published crosswalk rows. Those must be released first;
-- the statements below do that in dependency order. Tenant requirement rows
-- for the Core Assurance Set are left in place (they are ordinary framework
-- content and may be referenced by issued questionnaires); only their canonical
-- identity is detached.
--
-- The append-only guard refuses DELETE/TRUNCATE but not DROP TABLE.

DROP TABLE IF EXISTS vendor_engagement_composition_snapshots;
DROP FUNCTION IF EXISTS vendor_engagement_composition_snapshots_check_engagement();

UPDATE frameworks SET framework_key = NULL WHERE framework_key = 'securelogic-core-assurance';
DELETE FROM canonical_control_crosswalk WHERE framework_key = 'securelogic-core-assurance';
DELETE FROM canonical_framework_versions WHERE framework_key = 'securelogic-core-assurance';
