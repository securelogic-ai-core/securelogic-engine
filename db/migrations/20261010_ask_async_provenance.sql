-- Migration: ask_async_provenance
-- Package:   Ask SecureLogic — asynchronous provenance for long answers
--
-- WHY THIS EXISTS, measured rather than assumed. Decomposing an answer into
-- verified claims costs ~11x the answer in OUTPUT tokens at ~85-100 tok/s
-- (staging a2a0f49e: answerChars 1162 -> outputTokens 3163 in 37.1s). A
-- 3,000-char answer therefore needs ~8,250 tokens ~= 97s — past the whole 90s
-- interactive budget before orchestration has spent anything.
--
-- So long answers were never going to be citable on the request path. Tuning
-- the synchronous budget could only ever choose WHICH way they failed: refuse
-- early and ship uncited, or run and be cut off. Both ship an answer whose
-- claims nobody verified.
--
-- The answer moves to the user immediately; the decomposition moves off the
-- request. Two things make that safe, and they are the whole design:
--
-- ── 1. The worker must not out-read the user who asked ──────────────────────
--
-- A background job that re-queried canonical data would be a NEW read, at a
-- later time, under whatever identity the worker happens to hold. That is a
-- privilege boundary this platform does not cross: ASK-A's guarantee is that
-- Ask sees exactly what the ASKING USER is authorized to see, filtered by their
-- seat scope, at the moment they asked.
--
-- `ask_provenance_contexts` therefore FREEZES the authorized tool results the
-- answer was actually built from, and the worker reads nothing else. It issues
-- no canonical query, so it cannot widen scope, cannot observe rows created
-- after the turn, and cannot see anything the user was denied. Authorization is
-- inherited by construction rather than re-derived — there is no second
-- authorization decision to get wrong.
--
-- ── 2. That freeze is a second copy of customer risk data, so it is temporary ─
--
-- `ask_tool_invocations` deliberately stores a SHAPE (counts, ids, cited
-- aggregates) and never full payloads, precisely so the audit ledger does not
-- double the blast radius of a leak. This table holds what that one refuses to,
-- which is why it is PURGED the moment the job reaches a terminal state:
-- `tool_payloads` is nulled and `purged_at` stamped in the same transaction
-- that attaches the claims. The steady state is an empty table; a row here is
-- work in flight, not a record.
--
-- Retention is bounded on the other side too — a job that never terminates is
-- reaped by max_attempts, and its context is purged with it.
--
-- Additive only. Nothing reads these columns until the worker ships.

-- ---------------------------------------------------------------
-- ask_messages.provenance_status — the lifecycle, visible to the UI
-- ---------------------------------------------------------------
--
-- NULL is not a state: it means provenance was never applicable to this turn
-- (retrieval never happened, or the feature is off), which is how every row
-- written before this migration reads. The four real states are explicit
-- because the alternative — inferring "verified" from a non-empty claims
-- column — cannot distinguish "decomposition failed" from "nothing to say",
-- and would present an unverified answer as a verified one.

ALTER TABLE ask_messages
  ADD COLUMN IF NOT EXISTS provenance_status TEXT NULL;

ALTER TABLE ask_messages
  DROP CONSTRAINT IF EXISTS ask_messages_provenance_status_check;

ALTER TABLE ask_messages
  ADD CONSTRAINT ask_messages_provenance_status_check CHECK (
    provenance_status IS NULL
    OR provenance_status IN ('pending', 'complete', 'partial', 'failed')
  );

COMMENT ON COLUMN ask_messages.provenance_status IS
  'Provenance lifecycle for an assistant turn. NULL = never applicable (no '
  'retrieval, or feature off). pending = decomposition deferred to the async '
  'worker. complete = claims attached and clean. partial = claims attached but '
  'some were downgraded or dropped. failed = decomposition did not produce '
  'claims; the answer stands UNCITED and must be shown as such.';

-- Worker/observability lookup: "which turns are still awaiting provenance?"
CREATE INDEX IF NOT EXISTS idx_ask_messages_provenance_pending
  ON ask_messages (organization_id, created_at DESC)
  WHERE provenance_status = 'pending';

-- ---------------------------------------------------------------
-- ask_provenance_contexts — the frozen, authorization-safe input
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ask_provenance_contexts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- UNIQUE is the idempotency key. A retried or duplicated job resolves to the
  -- same context and therefore the same message; claims are attached by an
  -- UPDATE guarded on the pending state, so a double-run cannot append a second
  -- set of claims to one answer.
  message_id       UUID        NOT NULL UNIQUE
                     REFERENCES ask_messages(id) ON DELETE CASCADE,

  -- The job that owns this context, for observability and reaping. No FK: the
  -- jobs row may be pruned by retention long after the context is purged.
  job_id           UUID        NULL,

  -- The authorized tool results this answer was built from, positionally
  -- aligned with ask_tool_invocations for the same message. NULLED on
  -- completion — see the header. This is the only place full tool output is
  -- ever written, and only for as long as a job is in flight.
  tool_payloads    JSONB       NULL,

  -- Frozen so the worker decomposes the ANSWER THAT WAS SENT. Re-reading it
  -- from ask_messages would be equivalent today, but the answer column is what
  -- the provenance pass re-renders on success, so depending on it would make
  -- the input change under the job it is feeding.
  answer           TEXT        NOT NULL,
  model_id         TEXT        NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at        TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_ask_provenance_contexts_unpurged
  ON ask_provenance_contexts (created_at)
  WHERE purged_at IS NULL;

COMMENT ON TABLE ask_provenance_contexts IS
  'Frozen authorized tool results for a deferred provenance job. The worker '
  'reads ONLY this — it issues no canonical query, so it cannot out-read the '
  'user whose turn produced it (ASK-A equivalence by construction). '
  'tool_payloads is NULLED and purged_at stamped in the same transaction that '
  'attaches the claims: a row here is work in flight, never a record.';

-- ---------------------------------------------------------------
-- RLS — same tenant predicate as the tables it derives from
-- ---------------------------------------------------------------

ALTER TABLE ask_provenance_contexts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ask_provenance_contexts_tenant_isolation ON ask_provenance_contexts;
CREATE POLICY ask_provenance_contexts_tenant_isolation ON ask_provenance_contexts
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ask_provenance_contexts TO app_request;

-- ---------------------------------------------------------------
-- jobs — register the new durable type
-- ---------------------------------------------------------------
--
-- Reusing the generic queue rather than inventing one: it already has the
-- claim (FOR UPDATE SKIP LOCKED), the visibility timeout, bounded attempts and
-- dead-lettering that a provenance retry needs, and a second queue would mean a
-- second set of all of them to get right.

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_job_type_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_type_check
    CHECK (job_type IN (
      'data_export_self',
      'data_export_org',
      'account_deletion_reap',
      'export_file_purge',
      'vendor_assurance_extract',
      'applicability_reassess',
      'connector_sync',
      'vendor_evidence_analysis',
      'ask_provenance'
    ));
