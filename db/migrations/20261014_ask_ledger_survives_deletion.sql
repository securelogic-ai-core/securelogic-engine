-- Migration: ask_ledger_survives_deletion
-- Package:   E-1 — Tenant Data Governance
--
-- THE DEFECT THIS FIXES. `ask_tool_invocations` was built to be the audit
-- ledger AND the provenance substrate — 20260922 says so, and
-- dataClassification.ts states it "must survive an erasure that removes the
-- conversation it describes". It cannot. `message_id` is
-- `NOT NULL REFERENCES ask_messages(id) ON DELETE CASCADE`, so the first
-- deletion of conversation content — owner request, retention expiry or
-- account erasure — destroys the audit record of what the assistant read on
-- that user's behalf, including the DENIALS, which are the rows an auditor
-- actually asks for.
--
-- The fix is the smallest one that makes the ledger outlive its content:
--
--   1. message_id becomes NULLABLE with ON DELETE SET NULL. A deleted message
--      leaves its invocations standing, orphaned by design.
--   2. conversation_id is added (nullable, ON DELETE SET NULL) and backfilled,
--      so an orphaned row is still attributable to a thread. Without it, a
--      ledger row that has lost its message is attributable only to an org.
--
-- This is also what makes the sweeper's provenance invariant expressible
-- (TDG-5): a ledger row becomes eligible for its own expiry ONLY when
-- `message_id IS NULL` — i.e. only after the message it describes is already
-- gone. A live answer therefore cannot lose its evidence chain, by
-- construction rather than by query discipline.
--
-- Safety: ADDITIVE and NON-DESTRUCTIVE. Dropping NOT NULL and widening a
-- CASCADE to SET NULL both loosen constraints — no existing row can violate
-- either. The backfill is a single idempotent UPDATE over rows whose
-- conversation_id is NULL. Production holds hours of Ask data at this point;
-- this is the cheapest moment this change will ever have.

-- ---------------------------------------------------------------
-- 1. conversation_id — attribution that survives the message
-- ---------------------------------------------------------------

ALTER TABLE ask_tool_invocations
  ADD COLUMN IF NOT EXISTS conversation_id UUID NULL
    REFERENCES ask_conversations(id) ON DELETE SET NULL;

-- Idempotent: only touches rows that have not been backfilled, and only where
-- the parent message still exists.
UPDATE ask_tool_invocations ati
   SET conversation_id = am.conversation_id
  FROM ask_messages am
 WHERE am.id = ati.message_id
   AND ati.conversation_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ask_tool_invocations_conversation
  ON ask_tool_invocations (organization_id, conversation_id, created_at ASC);

-- ---------------------------------------------------------------
-- 2. message_id — nullable, and SET NULL instead of CASCADE
-- ---------------------------------------------------------------

ALTER TABLE ask_tool_invocations
  ALTER COLUMN message_id DROP NOT NULL;

-- Postgres auto-names an inline column-level FK `<table>_<column>_fkey`.
ALTER TABLE ask_tool_invocations
  DROP CONSTRAINT IF EXISTS ask_tool_invocations_message_id_fkey;

ALTER TABLE ask_tool_invocations
  ADD CONSTRAINT ask_tool_invocations_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES ask_messages(id) ON DELETE SET NULL;

-- The sweeper's eligibility predicate (TDG-5): orphaned ledger rows only.
CREATE INDEX IF NOT EXISTS idx_ask_tool_invocations_orphaned
  ON ask_tool_invocations (organization_id, created_at)
  WHERE message_id IS NULL;

COMMENT ON COLUMN ask_tool_invocations.message_id IS
  'The turn this read belongs to. NULLED (not cascaded) when the message is '
  'deleted, so the audit ledger — including denials — outlives the content it '
  'describes. A NULL here is also the sweeper''s eligibility signal: a ledger '
  'row may only expire after its message is already gone.';

COMMENT ON COLUMN ask_tool_invocations.conversation_id IS
  'Denormalised thread attribution so an orphaned ledger row (message_id NULL) '
  'remains traceable to a conversation rather than only to an organization.';
