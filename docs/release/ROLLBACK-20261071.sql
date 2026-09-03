-- ROLLBACK for 20261071_attributed_approval (#947).
--
-- Removes the trigger that makes a NEW unattributed approval impossible.
-- Code rollback alone is NOT sufficient if the application-layer guard is also
-- reverted: together they are what enforce "a governance-relevant human
-- approval must have an attributed human actor". Dropping this reopens the
-- database half.
--
-- NO DATA LOSS. The trigger adds no column and rewrites nothing; existing
-- approvals and their approvers are untouched by both the migration and this
-- rollback.
--
-- ── KNOWN ROLLBACK CONSTRAINT (Option-B curated RC review, 2026-09-03) ──────
--
-- THERE IS NO SAFE CODE-ONLY ROLLBACK FOR 20261071 WHILE VENDOR ASSURANCE IS
-- ENABLED. Recorded here as a release constraint, deliberately NOT "solved" by
-- manufacturing a destructive rollback.
--
-- The trigger raises 23514 on any transition into `approved` where
-- approved_by_user_id or approved_at is NULL. Code from before #951 approves
-- documents WITHOUT setting those fields. So the three-way combination:
--
--     migration applied  +  code reverted below #951  +  VA enabled
--
-- makes the approval path FAIL CLOSED at the database. Approvals raise
-- 'approval of vendor_assurance_document <id> has no attributed human approver'
-- instead of committing. That is the correct security posture and the wrong
-- availability posture, and it is not something a redeploy alone resolves.
--
-- WHY IT IS NOT A BLOCKER TODAY. All three legs must hold. As measured
-- 2026-09-03 on production: SECURELOGIC_VENDOR_ASSURANCE_ENABLED is NOT 'true'
-- (proven behaviourally — /api/vendor-assurance/documents returns the
-- feature-flag 404 shape {"error":"not_found"} with no `path` key, which the
-- router's own 404 always carries), and prod holds zero vendor assurance
-- documents. The third leg is absent, so the constraint is latent.
--
-- IT BECOMES LIVE THE MOMENT VA IS ENABLED IN PRODUCTION ON REVERTED CODE.
--
-- THE TWO SUPPORTED RECOVERY PATHS, in preference order:
--   1. Roll forward. Keep the trigger; fix forward on code at or above #951.
--      This is the intended path and the only one that preserves the guarantee.
--   2. If the schema genuinely must go, run the DROP statements below AS PART OF
--      the same change window as the code revert — never the code alone. Note
--      that this reopens the database half of the attributed-approval guarantee
--      (see the note above), so it is an explicit, authorized security decision,
--      not a routine rollback step.
--
-- Do NOT reorder these: dropping the trigger before the function is required,
-- and both must land together with the code revert if path 2 is taken.

-- Idempotent.

DROP TRIGGER IF EXISTS trg_vendor_assurance_require_attributed_approval
  ON vendor_assurance_documents;

DROP FUNCTION IF EXISTS vendor_assurance_require_attributed_approval();
