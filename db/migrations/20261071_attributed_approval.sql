-- Migration: attributed_approval
-- Package:   #947 — a governance-relevant human approval must have an
--            attributed human actor (slot 20261071)
--
-- `POST /vendor-assurance/documents/:id/approve` writes
-- `approved_by_user_id = req.userId ?? null` under a guard stack that does not
-- require a user session, and `vendor_assurance_documents_approved_consistency`
-- checks only `approved_at IS NOT NULL AND processing_status = 'approved'` —
-- it says nothing about the approver. So an API-key-only integration can
-- produce an `approved` document (documented in-tree as "terminal-success /
-- the version of record") with NO HUMAN ATTACHED TO THE APPROVAL.
--
-- ── Why this is a TRIGGER and not the obvious CHECK ─────────────────────────
--
-- The obvious form is a steady-state CHECK:
--
--     CHECK (processing_status <> 'approved'
--            OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL))
--
-- That is WRONG here, and the reason is two lines away in 20260612:
--
--     approved_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL
--
-- A steady-state CHECK is re-evaluated on EVERY update of the row, including
-- the UPDATE that `ON DELETE SET NULL` performs when a referenced user is
-- deleted. Deleting a user who had approved a document would therefore FAIL
-- with a check violation — turning a data-protection operation into an error,
-- which is a worse defect than the one being fixed, and a repeat of a mistake
-- this repository has already made once (WORM/FK cascade blocking tenant
-- erasure).
--
-- Measured before choosing: product code NEVER deletes a user row — the
-- account-deletion reaper TOMBSTONES via UPDATE (accountDeletionReaperPolicy.ts,
-- TOMBSTONE_USER_PATCH). The only `DELETE FROM users` statements in the tree are
-- in validation/seed scripts. So the CHECK would not fire in production today.
-- It is still the wrong instrument: it makes a correct future erasure
-- implementation fail, and the hazard is invisible until it does.
--
-- The trigger below fires ONLY on the transition INTO `approved` — the moment
-- the governance decision is made. It cannot fire on a later FK-driven
-- SET NULL, on a tombstone, or on any unrelated update, so historical rows and
-- user deletion are unaffected while a NEW unattributed approval is impossible.
--
-- ── Existing data, measured on staging before writing this ──────────────────
--
--   approved documents ................................. 2
--   approved with a NULL approver ...................... 0
--   approved with a NULL approved_at ................... 0
--   legacy `finalized` rows ............................ 0
--   approved rows whose approver row is missing ........ 0
--   approval audit events with a NULL actor ............ 0
--
-- Both approvals are attributed to an active user. There are NO historical
-- unattributed approvals to preserve, remediate, or backfill — and nothing is
-- backfilled here. A human identity is never fabricated.
--
-- Scope: `approved` only. The legacy `finalized` state keeps its existing
-- consistency CHECK untouched; it has zero rows and its route is legacy.
--
-- Rollback: docs/release/ROLLBACK-20261071.sql
-- Idempotent, re-runnable. No data rewritten, no column added.

CREATE OR REPLACE FUNCTION vendor_assurance_require_attributed_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Only the TRANSITION into `approved`. An UPDATE that leaves the row already
  -- approved (including ON DELETE SET NULL nulling the approver later) is not
  -- this trigger's business.
  IF NEW.processing_status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.processing_status IS DISTINCT FROM 'approved')
  THEN
    IF NEW.approved_by_user_id IS NULL OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION
        'approval of vendor_assurance_document % has no attributed human approver', NEW.id
        USING ERRCODE = '23514',
              HINT = 'A governance-relevant approval must name the person who made it. '
                     'Approve as an authenticated user; an API-key-only caller cannot approve.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION vendor_assurance_require_attributed_approval() IS
  'Issue #947. Makes a NEW unattributed approval impossible at the database '
  'layer. Deliberately a trigger scoped to the transition into `approved` '
  'rather than a steady-state CHECK, because approved_by_user_id carries '
  'ON DELETE SET NULL and a steady-state CHECK would make deleting a user who '
  'had approved a document fail.';

DROP TRIGGER IF EXISTS trg_vendor_assurance_require_attributed_approval
  ON vendor_assurance_documents;

CREATE TRIGGER trg_vendor_assurance_require_attributed_approval
  BEFORE INSERT OR UPDATE ON vendor_assurance_documents
  FOR EACH ROW
  EXECUTE FUNCTION vendor_assurance_require_attributed_approval();
