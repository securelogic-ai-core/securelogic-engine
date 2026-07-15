-- Migration: action_block_metadata
-- Walkthrough remediation R-10 — a blocked remediation Action must capture WHY it
-- is blocked, not just flip a status. The Decision Workspace's "Block" control was
-- a bare status transition with nowhere to record the blocker, its dependency, who
-- owns unblocking it, or when it is expected to clear.
--
-- Four nullable columns on `actions`. All optional (a block can be recorded with
-- just a reason). Additive, no backfill, reversible — existing rows and the
-- existing PATCH contract are unaffected. `blocked_owner_user_id` mirrors the
-- existing owner_user_id FK semantics (ON DELETE SET NULL).

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS blocked_reason                TEXT,
  ADD COLUMN IF NOT EXISTS blocked_dependency            TEXT,
  ADD COLUMN IF NOT EXISTS blocked_owner_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked_expected_unblock_date DATE;
