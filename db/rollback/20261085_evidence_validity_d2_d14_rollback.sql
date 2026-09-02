-- Rollback for 20261085_evidence_validity_policy_d2_d14.sql
--
-- Returns the evidence-validity policy to its post-20261083 shape: D1 only,
-- four anchors, no requires_artifact_end.
--
-- SAFE, and here is precisely why. This migration writes NO evidence row. A
-- validity window is computed at CURATION time and snapshotted onto the
-- evidence row (valid_from / valid_until / validity_basis); removing a policy
-- row does not retract a window a human already committed. What reverts is what
-- the platform would compute NEXT, plus the S4 counting predicate's read-time
-- currency answer for SOC classes.
--
-- WHAT THIS ROLLBACK DELIBERATELY DOES NOT DO
--
--   It does not delete evidence rows curated under the D2-D14 classes, and it
--   does not reset their assurance_class. Those are human judgements about what
--   an artifact IS, made under a ratified policy, and they remain true after a
--   policy is withdrawn. They simply stop resolving to a policy window, which
--   is the fail-closed outcome.
--
-- REFUSAL GUARD
--
--   The rollback ABORTS if any organization has configured a validity setting
--   for a class this migration introduced. Dropping the platform ceiling out
--   from under a live customer setting would leave a configured duration with
--   no policy to bound it, which the guardrail trigger treats as
--   unconfigurable. Supersede those settings first, deliberately, then roll
--   back.

BEGIN;

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM organization_evidence_validity_settings
   WHERE superseded_at IS NULL
     AND assurance_class IN (
       'iso_certification', 'pen_test', 'vulnerability_scan', 'policy_document',
       'bcp_dr_test', 'technical_configuration', 'vendor_attestation',
       'privacy_agreement', 'subprocessor_list', 'ai_evaluation'
     );
  IF n > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back: % live organization_evidence_validity_settings row(s) reference a class this migration introduced. Supersede them first.', n;
  END IF;
END $$;

-- 1. Remove the classes 20261085 introduced.
DELETE FROM evidence_validity_policy
 WHERE assurance_class IN (
   'iso_certification', 'pen_test', 'vulnerability_scan', 'policy_document',
   'bcp_dr_test', 'technical_configuration', 'vendor_attestation',
   'privacy_agreement', 'subprocessor_list', 'ai_evaluation'
 );

-- 2. Restore D1's version 1 as the live SOC policy (drops the bridge condition).
DELETE FROM evidence_validity_policy
 WHERE assurance_class IN ('soc1', 'soc2_type2')
   AND version = 2;

UPDATE evidence_validity_policy
   SET superseded_at = NULL
 WHERE assurance_class IN ('soc1', 'soc2_type2')
   AND version = 1;

-- 2b. Restore soc2_type1 version 1 as well (it was superseded only to gain
--     no_window_reason).
DELETE FROM evidence_validity_policy
 WHERE assurance_class = 'soc2_type1' AND version = 2;

UPDATE evidence_validity_policy
   SET superseded_at = NULL
 WHERE assurance_class = 'soc2_type1' AND version = 1;

-- 3. Drop the mechanisms this migration added.
ALTER TABLE evidence_validity_policy
  DROP CONSTRAINT IF EXISTS evidence_validity_policy_new_columns_shape_check;
ALTER TABLE evidence_validity_policy
  DROP CONSTRAINT IF EXISTS evidence_validity_policy_object_cadence_ceiling_check;

ALTER TABLE evidence_validity_policy
  DROP COLUMN IF EXISTS requires_artifact_end;
ALTER TABLE evidence_validity_policy
  DROP COLUMN IF EXISTS artifact_basis_permitted;
ALTER TABLE evidence_validity_policy
  DROP COLUMN IF EXISTS bridge_required_above_months;
ALTER TABLE evidence_validity_policy
  DROP COLUMN IF EXISTS no_window_reason;

-- 4. Restore the original anchor vocabulary. Safe only because every row that
--    used artifact_stated_date or object_cadence was deleted above.
ALTER TABLE evidence_validity_policy
  DROP CONSTRAINT IF EXISTS evidence_validity_policy_anchor_check;

ALTER TABLE evidence_validity_policy
  ADD CONSTRAINT evidence_validity_policy_anchor_check CHECK (
    anchor IN ('report_period_end', 'collected_at', 'artifact_term', 'none')
  );

COMMIT;
