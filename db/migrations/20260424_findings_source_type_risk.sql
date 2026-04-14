-- findings-source-type-risk
--
-- Expands the findings.source_type CHECK constraint to include:
--   'obligation_review' — already used by obligation-assessment-workflow
--                         but was not in the original constraint definition
--   'risk'             — allows findings to be sourced from risk register entries
--
-- source_id on findings carries the risk UUID when source_type = 'risk'.
-- No FK is enforced (consistent with the pattern for all other source types
-- except 'assessment', which references assessments.id via assessment_id).
--
-- Additive only. Does not modify existing rows or add new tables.

ALTER TABLE findings
  DROP CONSTRAINT IF EXISTS findings_source_type_check;

ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
    CHECK (source_type IN (
      'assessment',
      'control_test',
      'vendor_review',
      'ai_review',
      'obligation_review',
      'signal',
      'manual',
      'risk'
    ));
