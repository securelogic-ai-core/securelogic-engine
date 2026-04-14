-- risk-action-linkage
--
-- Expands the actions.source_type CHECK constraint to include 'risk',
-- allowing remediation actions to be linked directly to risk register entries.
--
-- source_id on actions carries the risk UUID when source_type = 'risk'.
-- No FK is added (consistent with the pattern used for other source_type values:
-- assessment, finding, signal, manual — none are FK-enforced).
--
-- Additive only. Does not modify existing rows.

ALTER TABLE actions
  DROP CONSTRAINT IF EXISTS actions_source_type_check;

ALTER TABLE actions
  ADD CONSTRAINT actions_source_type_check
    CHECK (source_type IN ('assessment', 'finding', 'signal', 'manual', 'risk'));
