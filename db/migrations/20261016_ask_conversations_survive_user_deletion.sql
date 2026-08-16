-- Migration: ask_conversations_survive_user_deletion
-- Package:   E-1 — Tenant Data Governance (operator ruling, 2026-08-16)
--
-- THE RULING. Ask conversations are ORGANIZATION-GOVERNED RECORDS. They do not
-- automatically die when the originating user account is deleted; they are
-- preserved under the organization's applicable TDG retention policy, and a
-- legal hold outranks that.
--
-- THE CONTRADICTION THIS FIXES. `ask_conversations.user_id` was declared
-- `ON DELETE CASCADE`, so deleting a users row would destroy the conversation
-- and — transitively — every message in it. That is precisely the outcome the
-- ruling forbids, and it sat one hard DELETE away from happening.
--
-- It is latent rather than live today: the Art.17 reaper TOMBSTONES the users
-- row (decision-lock D-1) instead of deleting it, so the cascade has never
-- fired and the UUID survives to keep every reference intact. Latent is not
-- safe, though — the reaper's scope explicitly excludes admin-member deletion
-- (D-5), so the first code that hard-deletes a user would silently take the
-- organization's Ask history with it, with no error and nothing in the audit
-- log to show what was lost.
--
-- Note the asymmetry this closes: `ask_messages.user_id` was ALREADY
-- `ON DELETE SET NULL` (20260922). The turn was built to outlive its author;
-- the thread was not. They now agree.
--
-- CONSEQUENCE, stated rather than discovered. A conversation whose owner is
-- gone has `user_id = NULL`. It therefore has no owner who can request its
-- deletion (only an administrator can), and a SUBJECT-SCOPED legal hold no
-- longer covers it, because there is no subject left to match — holdPredicate
-- deliberately does not widen a subject hold to the whole class. When a hold
-- must survive the erasure of the person it concerns, place it at organization,
-- data_class or object scope. This is documented in the E-1 invariants rather
-- than papered over with a denormalised copy of the user id, which would
-- reintroduce exactly the un-FK'd actor-reference antipattern the platform
-- already regrets (the deprecated free-text `reviewer_id` columns).
--
-- Safety: ADDITIVE and LOOSENING. Replacing CASCADE with SET NULL removes a
-- destructive action; no existing row can violate the new constraint, the
-- column is already nullable, and no data is touched.

ALTER TABLE ask_conversations
  DROP CONSTRAINT IF EXISTS ask_conversations_user_id_fkey;

ALTER TABLE ask_conversations
  ADD CONSTRAINT ask_conversations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN ask_conversations.user_id IS
  'The thread owner. NULL for API-key callers with no human identity, and '
  'NULLED (never cascaded) if the user record is deleted: an Ask conversation '
  'is an organization-governed record that outlives its author and expires '
  'under the organization''s TDG retention policy. An owner-less thread has no '
  'owner-deletion path and is not covered by subject-scoped legal holds.';
