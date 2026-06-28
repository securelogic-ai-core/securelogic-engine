-- ============================================================
-- Team / default seat cap: 10 -> 6
-- 2026-07-11 (sequence-dated after 20260710 per migration convention)
--
-- The locked launch model sets the self-serve default seat cap (Free / Pro /
-- Team) to 6. `organizations.max_members` is the single per-org seat cap
-- (there is no per-tier seat logic); Platform / Enterprise are raised above the
-- default by an operator via PATCH /admin/organizations/:id. See seatLimit.ts.
--
-- This migration:
--   1. lowers the column DEFAULT 10 -> 6 (new orgs get 6), and
--   2. backfills existing rows STILL AT THE OLD DEFAULT (max_members = 10) to 6.
--      The `WHERE max_members = 10` guard deliberately SPARES any operator-raised
--      Platform / Enterprise caps (which are > 10, e.g. 50) — those are never
--      lowered. Rows already below 10 are untouched.
--
-- Additive + idempotent: re-running re-asserts DEFAULT 6 and re-matches no rows
-- (none remain at 10 after the first run). Safe to re-run.
--
-- ROLLBACK (manual, if ever needed):
--   ALTER TABLE organizations ALTER COLUMN max_members SET DEFAULT 10;
--   -- Note: the 10->6 backfill is NOT auto-reversible (a 6 could be an original
--   -- 6 or a backfilled 10). With no external customers at launch this is
--   -- acceptable; to restore specific orgs, set max_members explicitly via the
--   -- admin PATCH path.
-- ============================================================

-- 1. New default for future orgs.
ALTER TABLE organizations
  ALTER COLUMN max_members SET DEFAULT 6;

-- 2. Backfill existing rows that are still at the old default of 10.
--    Operator-raised caps (> 10) and any caps already below 10 are left alone.
UPDATE organizations
  SET max_members = 6
  WHERE max_members = 10;
