-- Migration: ask_proposed_actions (Stop Gate ASK-B, Launch Completion 5)
--
-- The proposal ledger for Ask's bounded agentic mutations. When the model
-- calls a `mutate`-class tool, NOTHING executes: a row is created here with
-- the tool name and its EXACT input frozen at proposal time, and a
-- server-issued confirmation token is minted AFTER the model loop has ended
-- (so token material cannot exist in model context even in principle — the
-- structural defeat of "the model confirms its own action" and of any
-- prompt-injected confirmation).
--
-- Custody model follows data_export_files.download_token_hash exactly:
-- the raw 256-bit token goes to the CLIENT in the HTTP response and is never
-- persisted; only its SHA-256 lands here, and the confirm route looks the row
-- up BY hash, so a DB read can never expose a usable token.
--
-- The row IS the binding that makes confirmation safe:
--   * organization_id + user_id — the confirming request must present the
--     SAME user in the SAME org that received the proposal. Tenant/user
--     context cannot change between proposal and execution.
--   * tool_input — frozen server-side; the confirm request carries ONLY the
--     token, so the client cannot alter what was proposed. Confirmation is
--     bound to the exact proposed mutation.
--   * status + the atomic pending→confirmed claim — single use. A replayed or
--     double-submitted confirmation loses the UPDATE ... WHERE status =
--     'pending' race and is denied. A consumed token stays consumed even when
--     execution is refused: authorization is re-evaluated at execution time by
--     running the canonical route chain, and a refusal must not make the token
--     retryable.
--   * expires_at — proposals are turn-scoped; a stale proposal cannot execute.
--
-- user_id is NOT NULL by design: a proposal without a human to confirm it is
-- meaningless, so callers with no user identity (bare API keys) are offered
-- read tools only.

CREATE TABLE IF NOT EXISTS ask_proposed_actions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id       UUID        NULL REFERENCES ask_conversations(id) ON DELETE CASCADE,

  tool_name             TEXT        NOT NULL,
  -- The exact arguments the tool will execute with, frozen at proposal time.
  tool_input            JSONB       NOT NULL,
  -- Human-readable change-set rendered SERVER-side from tool_name+tool_input
  -- (never by the model), shown on the confirmation card. What the user
  -- confirms is what the server rendered, not what the model narrated.
  summary               TEXT        NOT NULL,

  -- SHA-256 hex of the raw confirmation token. NULL until minted (minting is
  -- a separate post-orchestration step); UNIQUE so lookup-by-hash is total.
  token_hash            TEXT        NULL UNIQUE,

  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'confirmed', 'declined', 'expired')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,
  resolved_at           TIMESTAMPTZ NULL,

  -- Execution outcome, recorded on the confirmed row: the HTTP status the
  -- canonical route chain produced and a SHAPE digest (ids/counts — never the
  -- full payload, same discipline as ask_tool_invocations.output_digest).
  executed_http_status  INTEGER     NULL,
  execution_digest      JSONB       NULL
);

-- Confirm-path lookup is by token_hash (the UNIQUE index above). This index
-- serves the per-user listing/expiry sweeps.
CREATE INDEX IF NOT EXISTS idx_ask_proposed_actions_org_user_status
  ON ask_proposed_actions (organization_id, user_id, status, created_at DESC);

-- RLS lands with the table (same invariant as the ask_* trio: no routes exist
-- yet at migration time, so every route added inherits an enforcing table).
ALTER TABLE ask_proposed_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_proposed_actions_tenant_isolation ON ask_proposed_actions;
CREATE POLICY ask_proposed_actions_tenant_isolation ON ask_proposed_actions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ask_proposed_actions TO app_request;
