-- findings-due-date
--
-- Adds the `due_date` column to the findings table.
--
-- POST /api/findings (findings.ts) and findingValidation.ts have always
-- accepted, inserted, and returned a `due_date` field, but no migration ever
-- created the column. Any database built purely from the migration set
-- therefore 500s on POST /api/findings ("column \"due_date\" of relation
-- \"findings\" does not exist"). Surfaced by the E1-G1 cross-org isolation
-- harness while seeding test data; root cause and analysis in
-- docs/investigation/e1-g1-harness-first-run-2026-05-21.md.
--
-- IF NOT EXISTS makes this idempotent and safe whether or not the target
-- database already carries the column (e.g. if it was added out-of-band on
-- an existing environment). Additive, nullable, no backfill required.
--
-- Migration sequence note: the repo's migration numbers are a forward-
-- running sequence, not real calendar dates. 20260617 sequences after
-- 20260616_auth_anomaly_alerts.sql.

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS due_date DATE;
