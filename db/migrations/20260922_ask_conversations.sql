-- Migration: ask_conversations
-- Package:   Ask SecureLogic — A1 (conversation storage + tool-invocation ledger)
--
-- Ask shipped STATELESS and UNAUDITED: no conversation history, no record of
-- what was asked, and no record of what data the answer was built from. For an
-- LLM-mediated read path over customer risk data in a governance product, "who
-- asked what, and what were they shown" must be answerable after the fact.
--
-- Three tables:
--
--   ask_conversations       a thread
--   ask_messages            turns within it, content as structured claim blocks
--   ask_tool_invocations    EVERY authorized data read the assistant performed
--
-- ── ask_tool_invocations is the load-bearing one ────────────────────────────
--
-- It is simultaneously the audit ledger AND the provenance substrate. Every
-- citation an answer carries points at a row here, so an answer's evidence chain
-- survives independently of the model that produced it: an investigator can
-- reconstruct exactly which authorized reads occurred, in which order, with what
-- arguments, and whether each was permitted — without trusting the narrative.
--
-- `output_digest` deliberately stores a SHAPE (row counts, ids, the aggregate
-- values cited), never the full payload. Tool output is customer risk data;
-- copying it wholesale into a second table would double the blast radius of any
-- future leak for no investigative gain the ids do not already provide.
--
-- ── Conversations are USER-scoped for read, not just org-scoped ─────────────
--
-- A colleague in the same org must not read your Ask thread. It may contain data
-- filtered to YOUR seat scope (a Contributor sees only assigned objects) and is
-- phrased for you. Org-level RLS is therefore necessary but not sufficient: the
-- routes additionally scope by user_id, and RLS is the backstop.
--
-- Additive only. Empty at birth. RLS lands with the tables — they have no routes
-- yet, so the "policy => routes wrapped" invariant holds trivially and every
-- route added later inherits an already-enforcing table.

-- ---------------------------------------------------------------
-- ask_conversations
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ask_conversations (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL only for API-key callers with no human identity. A conversation with a
  -- user id is readable ONLY by that user.
  user_id            UUID        NULL REFERENCES users(id) ON DELETE CASCADE,

  title              TEXT        NULL,
  -- Voice shares this table by design: text and voice are two interfaces to the
  -- SAME intelligence, tools, authorization, provenance and audit. A separate
  -- voice history would be a second assistant wearing the same name.
  mode               TEXT        NOT NULL DEFAULT 'text'
                       CHECK (mode IN ('text', 'voice')),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_ask_conversations_org_user_recent
  ON ask_conversations (organization_id, user_id, last_message_at DESC NULLS LAST, id DESC);

-- ---------------------------------------------------------------
-- ask_messages
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ask_messages (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id    UUID        NOT NULL REFERENCES ask_conversations(id) ON DELETE CASCADE,

  -- Denormalised from the conversation, deliberately. Two consumers need a
  -- DIRECT user predicate rather than a join:
  --   1. the per-user read scope (a colleague must not read your thread), and
  --   2. the GDPR self-export, whose query builder matches on user columns and
  --      cannot follow a join.
  -- Both are correctness-critical, and a join neither can express is a worse
  -- trade than one denormalised column maintained at insert time.
  user_id            UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  role               TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),

  -- Plain text of the turn. For an assistant turn this is the rendered answer.
  content            TEXT        NOT NULL,

  -- Structured claim blocks for an assistant turn: an ordered array of
  -- { text, claim_class, citations[] } where claim_class is one of
  -- observed | derived | inference | recommendation.
  --
  -- Structure rather than prose-with-footnotes is what lets the assembler VERIFY
  -- an observed claim against the tool output it cites, and lets the UI render
  -- inference distinctly from fact. A model asked to write footnotes can write
  -- a footnote to nothing.
  claims             JSONB       NULL,

  -- Which model produced an assistant turn, and under which prompt. Required for
  -- reproducibility: an answer is only defensible if you know what produced it.
  model_id           TEXT        NULL,
  prompt_version     TEXT        NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ask_messages_assistant_has_model CHECK (
    role <> 'assistant' OR model_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_ask_messages_conversation
  ON ask_messages (conversation_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_ask_messages_org_created
  ON ask_messages (organization_id, created_at DESC);

-- ---------------------------------------------------------------
-- ask_tool_invocations  — the audit ledger AND provenance substrate
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ask_tool_invocations (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id         UUID        NOT NULL REFERENCES ask_messages(id) ON DELETE CASCADE,

  tool_name          TEXT        NOT NULL,
  action_class       TEXT        NOT NULL
                       CHECK (action_class IN ('read', 'draft', 'mutate', 'governed')),

  -- The arguments the model supplied, by value. Small, closed-schema, and
  -- exactly what an investigator needs to reproduce the read.
  input              JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- SHAPE of the result — row counts, returned ids, cited aggregates. Never the
  -- full payload: that is customer risk data, and copying it here would double
  -- the blast radius of a future leak for no investigative gain.
  output_digest      JSONB       NULL,

  -- FALSE when the canonical route denied the read. Recording denials is the
  -- point: "Ask tried to read X for this user and was refused" is exactly what
  -- an auditor asks, and a ledger of successes only cannot answer it.
  authorized         BOOLEAN     NOT NULL,
  status_code        INTEGER     NULL,
  error_code         TEXT        NULL,
  latency_ms         INTEGER     NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ask_tool_invocations_message
  ON ask_tool_invocations (message_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ask_tool_invocations_org_tool
  ON ask_tool_invocations (organization_id, tool_name, created_at DESC);

-- Denial review: "what did Ask try to read and get refused, org-wide?"
CREATE INDEX IF NOT EXISTS idx_ask_tool_invocations_denied
  ON ask_tool_invocations (organization_id, created_at DESC)
  WHERE authorized = FALSE;

COMMENT ON TABLE ask_tool_invocations IS
  'Audit ledger and provenance substrate for Ask. Every citation points at a row '
  'here, so an answer''s evidence chain survives independently of the model. '
  'output_digest stores SHAPE (counts, ids, cited aggregates), never full tool '
  'payloads — those are customer risk data. Denials are recorded, not just '
  'successes.';

-- ---------------------------------------------------------------
-- RLS — lands with the tables (no routes yet, invariant holds trivially)
-- ---------------------------------------------------------------

ALTER TABLE ask_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_conversations_tenant_isolation ON ask_conversations;
CREATE POLICY ask_conversations_tenant_isolation ON ask_conversations
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE ask_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_messages_tenant_isolation ON ask_messages;
CREATE POLICY ask_messages_tenant_isolation ON ask_messages
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE ask_tool_invocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_tool_invocations_tenant_isolation ON ask_tool_invocations;
CREATE POLICY ask_tool_invocations_tenant_isolation ON ask_tool_invocations
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ask_conversations     TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON ask_messages          TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON ask_tool_invocations  TO app_request;
