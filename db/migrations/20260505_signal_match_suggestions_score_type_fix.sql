-- Migration: signal_match_suggestions_score_type_fix
-- Package: schema-fix-match-score-and-metadata
--
-- Fixes a latent production bug surfaced by Package 3 (obligation-aware-risk-
-- scoring, 2e946cf8) and adds a JSONB column the matcher rewire package will
-- populate.
--
-- BUG BEING FIXED
-- ---------------
-- The original Package 1 migration declared:
--     match_score NUMERIC(4,3) NULL  -- 0.000..1.000 confidence
-- intending a 0..1 confidence value. Package 3's computeRiskScore returns
-- an INTEGER in [0, 100]. NUMERIC(4,3) holds 4 total digits with 3 after the
-- decimal — max representable value 9.999. Any score >= 10 from the recompute
-- endpoint would error on insert with a numeric overflow.
--
-- The bug is silent today only because no INSERT writer for
-- signal_match_suggestions exists in the codebase yet — the matcher rewire
-- is the next package. Package 3's recompute tests all mock pg.query and
-- never exercise the column type.
--
-- POST-MIGRATION COLUMN STATE (documented here in lieu of a runtime test —
-- the test suite has no existing pg_attribute introspection pattern, and we
-- decline to introduce one for a single assertion)
-- ---------------------------------------------------------------------------
--   match_score    INTEGER NULL
--                  CONSTRAINT signal_match_suggestions_match_score_chk
--                  CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100)
--   match_metadata JSONB NULL
--
-- SAFETY GUARD
-- ------------
-- Both changes are safe because the table is empty (verified by code
-- analysis on develop: zero INSERT call-sites for signal_match_suggestions).
-- The DO block below converts "should be empty" into "must be empty" with
-- a loud failure mode — if anything in dev managed to write rows between
-- Package 1 and now, the migration aborts the transaction rather than
-- silently corrupting data via the implicit NUMERIC→INTEGER cast.
--
-- IDEMPOTENCY
-- -----------
-- Each ALTER uses IF NOT EXISTS / IF EXISTS where Postgres supports it.
-- ADD COLUMN IF NOT EXISTS makes the JSONB add idempotent.
-- ALTER COLUMN TYPE is not natively idempotent; we guard it by checking the
-- current type via information_schema and skipping if already INTEGER. This
-- lets a partial re-run (e.g., aborted on a hook failure) recover cleanly.
-- The CHECK constraint add is wrapped in a NOT EXISTS guard for the same
-- reason. The schema_migrations row inserted by runMigrations.ts is the
-- canonical "this ran" marker; these guards make a stuck partial-apply
-- recoverable without manual intervention.

DO $$
DECLARE
  row_count BIGINT;
BEGIN
  SELECT count(*) INTO row_count FROM signal_match_suggestions;
  IF row_count > 0 THEN
    RAISE EXCEPTION 'schema-fix-match-score-and-metadata: expected empty signal_match_suggestions table, found % rows. Aborting to avoid silent data corruption from NUMERIC->INTEGER cast.', row_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. ALTER match_score: NUMERIC(4,3) -> INTEGER
-- ---------------------------------------------------------------------------
-- Empty table, so no USING clause is needed for value preservation. We still
-- guard with an information_schema check so a partial re-run is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'signal_match_suggestions'
       AND column_name = 'match_score'
       AND data_type = 'numeric'
  ) THEN
    ALTER TABLE signal_match_suggestions
      ALTER COLUMN match_score TYPE INTEGER
      USING NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. CHECK constraint on match_score range
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_name = 'signal_match_suggestions'
       AND constraint_name = 'signal_match_suggestions_match_score_chk'
  ) THEN
    ALTER TABLE signal_match_suggestions
      ADD CONSTRAINT signal_match_suggestions_match_score_chk
        CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. ADD COLUMN match_metadata JSONB NULL
-- ---------------------------------------------------------------------------
-- Captures matcher context for the queue UI: { source, matched_branch,
-- matched_string }. Empty today; the matcher rewire package populates it.

ALTER TABLE signal_match_suggestions
  ADD COLUMN IF NOT EXISTS match_metadata JSONB NULL;
