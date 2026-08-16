-- 20261011_requirement_responses_drop_legacy_unique.sql
--
-- Finish the job 20260924 intended and did not do.
--
-- THE DEFECT
-- ----------
-- 20260924_vendor_engagement_scope.sql replaces the original unique key on
-- requirement_responses with one that includes engagement_id, so that two
-- engagements with the same vendor can each hold an answer to the same
-- requirement. It says so in its own comment: "The replacement includes
-- engagement_id, so it is strictly WIDER". It then ran:
--
--   ALTER TABLE requirement_responses
--     DROP CONSTRAINT IF EXISTS
--       requirement_responses_organization_id_requirement_id_asses_key;   -- 62 chars
--
-- Postgres had actually named the constraint
--       requirement_responses_organization_id_requirement_id_assess_key    -- 63 chars
--
-- One character. IF EXISTS made the mismatch silent, so the DROP was a no-op
-- and the OLD four-column key survived alongside the new index. Verified on a
-- fresh database after the complete migration set: both exist.
--
-- WHY IT BITES
-- ------------
-- The portal upsert in savePortalAnswer specifies
--   ON CONFLICT (organization_id, requirement_id, assessment_type, subject_id,
--                COALESCE(engagement_id, '000...'::uuid))
-- which names the NEW index's expression. A collision on the OLD constraint is
-- therefore not handled by that clause — Postgres raises 23505 and the request
-- fails. Observed live on staging: PUT /api/vendor-portal/questions/:id returns
-- a deterministic 500 for any requirement the vendor already has a response row
-- for, and POST /vendor-portal/submit then refuses 422 "incomplete". The vendor
-- is hard-blocked with no message that tells them, or us, why.
--
-- MATCHED BY COLUMN SET, NOT BY NAME
-- ----------------------------------
-- Writing another literal name would repeat the original mistake, and the name
-- is not guaranteed to be identical across environments — an environment whose
-- table was created by a different path could carry a different auto-generated
-- name for the same constraint. This looks the constraint up by exactly the
-- four columns it constrains, so it cannot miss by a character and cannot drop
-- something it did not mean to.
--
-- SAFETY
-- ------
-- - Idempotent: if the constraint is already gone, the block does nothing.
-- - No uniqueness is lost. idx_requirement_responses_unique_scoped (added by
--   20260924) covers the same four columns PLUS COALESCE(engagement_id, zero),
--   so it is strictly wider. Self-assessment rows, which carry engagement_id
--   NULL, still collapse to the zero UUID and remain unique per
--   (organization_id, requirement_id, 'self', subject_id).
-- - Nothing depends on it: the only foreign key into requirement_responses is
--   requirement_response_revisions_response_id_fkey, which targets the PRIMARY
--   KEY, not this constraint.
-- - No rewrite and no scan of consequence: dropping a unique constraint drops
--   its index. It takes ACCESS EXCLUSIVE only briefly, and the migration runner
--   sets lock_timeout (5s default) since b363e144.
--
-- ROLLBACK
-- --------
-- Recreating it would restore the defect, so there is no "undo" worth naming.
-- If it must be restored for forensic reasons:
--   ALTER TABLE requirement_responses
--     ADD CONSTRAINT requirement_responses_legacy_unique
--     UNIQUE (organization_id, requirement_id, assessment_type, subject_id);
-- That will FAIL if any vendor has by then answered the same requirement under
-- two engagements — which is the behaviour this migration exists to allow.

DO $$
DECLARE
  legacy_constraint text;
BEGIN
  SELECT c.conname
    INTO legacy_constraint
    FROM pg_constraint c
   WHERE c.conrelid = 'requirement_responses'::regclass
     AND c.contype  = 'u'
     AND (
           SELECT array_agg(a.attname::text ORDER BY a.attname::text)
             FROM unnest(c.conkey) AS k(attnum)
             JOIN pg_attribute a
               ON a.attrelid = c.conrelid
              AND a.attnum   = k.attnum
         ) = ARRAY['assessment_type', 'organization_id', 'requirement_id', 'subject_id']
   LIMIT 1;

  IF legacy_constraint IS NULL THEN
    RAISE NOTICE 'requirement_responses: no legacy 4-column unique constraint present; nothing to drop.';
  ELSE
    RAISE NOTICE 'requirement_responses: dropping legacy unique constraint %', legacy_constraint;
    EXECUTE format(
      'ALTER TABLE requirement_responses DROP CONSTRAINT %I',
      legacy_constraint
    );
  END IF;
END
$$;
