-- 20261026_users_session_epoch.sql
--
-- Deterministic session invalidation (SEC-JWT-EPOCH).
--
-- WHY: session invalidation previously compared the JWT's `iat` (1-second
-- resolution) against users.password_changed_at (sub-second resolution):
--
--     payload.iat < Math.floor(password_changed_at_ms / 1000)
--
-- With a change landing at T+0.5s the boundary floors to T, so a token minted
-- at T+0.2s — BEFORE the change — satisfies `T < T` = false and was ACCEPTED.
-- Rounding the other way (ceil) closes that bypass but then rejects a session
-- minted at T+0.6s, immediately AFTER the change. No rounding of a coarse
-- clock against a fine-grained event can be both non-bypassable and non-racy,
-- so the timestamp comparison is replaced rather than tuned.
--
-- session_epoch is a monotonic counter. A JWT carries the epoch it was minted
-- under (`se`); the middleware compares integers. No clock, no rounding, no
-- second-boundary race: a session minted after an increment carries the new
-- value by construction.
--
-- DEFAULT 0 backfills every existing row. Tokens signed before this ships
-- carry NO `se` claim at all and are rejected outright by the middleware
-- (absence is invalid session state, not a compatibility fallback), so the
-- deploy forces a global re-login. That is intended.
--
-- Idempotent. No RLS/grant change: `users` already carries its policies and
-- app_request already holds column-level SELECT on the table.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.session_epoch IS
  'Monotonic session generation. Incremented on password reset, password change and any forced global logout. JWTs carry it as the `se` claim; a mismatch or an absent claim invalidates the session deterministically.';
