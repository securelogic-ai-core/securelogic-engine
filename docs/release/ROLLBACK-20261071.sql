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
-- Idempotent.

DROP TRIGGER IF EXISTS trg_vendor_assurance_require_attributed_approval
  ON vendor_assurance_documents;

DROP FUNCTION IF EXISTS vendor_assurance_require_attributed_approval();
