-- ROLLBACK for 20261059_questionnaire_content_primitives.sql (VA-Q1 / P1)
--
-- Additive migration; the rollback is a DROP. Safe at any point during P1
-- because nothing reads these tables yet (P2 is what addresses scope items by
-- version). Once P2 has stamped question_version_id on scope items / responses
-- this file is NOT sufficient — use ROLLBACK-20261059-20261061.sql, which
-- clears the stamps first so the FK RESTRICT does not refuse the drop.
--
-- Code rollback (redeploy the previous SHA) is always sufficient on its own;
-- the schema may stay.

DROP TRIGGER IF EXISTS trg_question_versions_immutable ON question_versions;
DROP TRIGGER IF EXISTS trg_question_versions_no_truncate ON question_versions;
-- worm_guard_mutation is the platform's shared guard (20261018); never dropped here.
DROP TABLE IF EXISTS question_requirement_links;
DROP TABLE IF EXISTS question_versions;
DROP TABLE IF EXISTS questions;
