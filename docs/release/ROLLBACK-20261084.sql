-- =====================================================================
-- ROLLBACK for 20261084 — governed evidence writer (curation guard + withdrawal)
-- =====================================================================
--
-- Drops withdraw_evidence() and returns the lifecycle event vocabulary to the
-- seven values 20261082 shipped.
--
-- SAFETY: this REFUSES to run if any 'withdrawn' event exists.
-- evidence_lifecycle_events is WORM — the shared worm_guard_mutation refuses
-- UPDATE and DELETE — so those rows CANNOT be removed or rewritten to satisfy
-- the narrower CHECK. That is the design working, not an obstacle: after a
-- withdrawal the event stream is the ONLY surviving record that the artifact
-- existed and was destroyed, and a rollback must never be the thing that erases
-- it. If you genuinely need to roll back past a withdrawal, the event rows must
-- be exported and the table rebuilt as a deliberate, separately-authorised
-- operation.

BEGIN;

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM evidence_lifecycle_events WHERE event_type = 'withdrawn';
  IF n > 0 THEN
    RAISE EXCEPTION
      'REFUSING to roll back 20261084: % ''withdrawn'' event(s) exist and are WORM-protected. These are the only surviving record of destroyed artifacts.', n;
  END IF;
END $$;

DROP FUNCTION IF EXISTS withdraw_evidence(UUID, UUID, TEXT);

-- PART A: the write-once envelope guard. Dropping it makes assurance_class and
-- the validity window freely restatable again — which is the pre-20261084
-- behaviour, and is why this rollback should not sit in place for long.
DROP TRIGGER IF EXISTS trg_evidence_envelope_write_once ON evidence;
DROP FUNCTION IF EXISTS evidence_envelope_write_once();

ALTER TABLE evidence_lifecycle_events
  DROP CONSTRAINT IF EXISTS evidence_lifecycle_event_type_check;
ALTER TABLE evidence_lifecycle_events
  ADD CONSTRAINT evidence_lifecycle_event_type_check CHECK (
    event_type IN (
      'linked',
      'confirmed',
      'detached',
      'superseded',
      'validity_established',
      'assurance_class_established',
      'expiry_observed'
    )
  );

COMMIT;

-- NOTE: the schema_migrations row is deliberately left in place, matching
-- ROLLBACK-20261080..83. Remove it explicitly only when a re-apply is intended:
--
--   DELETE FROM schema_migrations
--    WHERE filename = '20261084_evidence_governed_withdrawal.sql';
