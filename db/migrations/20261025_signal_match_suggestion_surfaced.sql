-- Migration: signal_match_suggestion_surfaced
-- Package: minimum surfaced-event telemetry (Candidate C evidence gate)
--
-- WHY
-- ---
-- Candidate C (narrowing matcher eligibility) is DEFERRED for want of
-- production customer-value evidence. The blocking gap is that we cannot tell
-- "a suggestion nobody valued" from "a suggestion nobody ever saw" — opposite
-- conclusions that today look identical, because nothing records whether a
-- generated suggestion was ever returned to a product surface.
--
-- WHAT
-- ----
-- Four columns on the EXISTING suggestion row rather than a new event table.
-- Deliberate: the row is already category C, org-scoped, RLS-enabled, and
-- CASCADEs on organization delete, so surfacing telemetry inherits tenant
-- isolation, retention and erasure treatment with no new governance surface
-- and no new framework. A separate event table would have needed all of that
-- re-established, and would have invited unbounded per-render inflation.
--
--   first_surfaced_at      -- set ONCE, the first time this suggestion is
--                             returned to a product surface. This is the column
--                             that answers "was it ever actually shown?".
--   last_surfaced_at       -- most recent MEANINGFUL surfacing (see dedup).
--   surface_count          -- count of MEANINGFUL surfacings, not renders.
--   last_surfaced_surface  -- short product-surface key, e.g. 'suggestions_list'.
--
-- NO PERSONAL DATA. No user id, no session id, no suggestion content, no prompt
-- or model output. `userRefColumns` for this table is unchanged, so individual
-- GDPR export/erasure obligations are unchanged.
--
-- DEDUP: a repeat within SURFACE_COALESCE_WINDOW_MS (30 min, in
-- suggestionSurfacedTelemetry.ts) updates nothing — re-rendering the same list
-- must not inflate the count. first_surfaced_at is still set on the first ever
-- surfacing because last_surfaced_at IS NULL passes the window predicate.
--
-- ADDITIVE ONLY: nullable columns plus one defaulted counter. No backfill — a
-- row that predates this migration correctly reads "never observed surfaced"
-- (NULL), which is not the same as "not surfaced" and must not be conflated.
-- No RLS change: the table's existing row policy governs these columns, since
-- RLS is row-scoped.
--
-- Rollback (forward-only convention): DROP the four columns; nothing reads them
-- outside suggestionSurfacedTelemetry.ts and the list route.

ALTER TABLE signal_match_suggestions
  ADD COLUMN IF NOT EXISTS first_surfaced_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_surfaced_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS surface_count         INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_surfaced_surface TEXT        NULL;

COMMENT ON COLUMN signal_match_suggestions.first_surfaced_at IS
  'First time this suggestion was returned to a user-facing product surface. NULL = never observed surfaced. Set once; never cleared.';
COMMENT ON COLUMN signal_match_suggestions.surface_count IS
  'Count of MEANINGFUL surfacings (repeats inside the coalesce window are not counted). Not a render count.';

-- Partial index: the funnel query filters on "ever surfaced", and the vast
-- majority of rows are expected to be NULL, so a partial index stays small.
CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_first_surfaced
  ON signal_match_suggestions (organization_id, first_surfaced_at)
  WHERE first_surfaced_at IS NOT NULL;
