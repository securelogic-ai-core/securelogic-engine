-- 20261023_llm_control_matcher_verdicts.sql
--
-- Idempotent LLM control-matcher verdicts (design:
-- docs/investigation/llm-verdict-cache-design.md + …-addendum.md).
--
-- WHY
-- ---
-- runLlmControlMatcherForSignal is the only LLM call in the weekly Brief run
-- whose volume scales as (orgs x fresh signals), and it runs strictly serially:
-- measured live on staging 2026-08-18 at 12 calls/min, ~5 s each, one org at a
-- time — a single org consumed 77+ minutes. Because cyber_signals dedup is
-- per-org, the same CVE is stored once per org and re-asked once per org, every
-- run. This table records the ANSWER so the same question is never paid for
-- twice.
--
-- KEY — (organization_id, signal_dedup_hash, control_inventory_digest,
--        prompt_version)
--   * signal_dedup_hash, NOT cyber_signals.id: a re-ingested CVE gets a new row
--     id but the same content hash. Keying on the id would miss every case this
--     table exists for.
--   * control_inventory_digest: a digest of the org's control set exactly as the
--     prompt sees it. Putting it IN THE KEY makes invalidation a property of the
--     key — change a control, get a key miss — instead of an invalidation job
--     someone must remember to run.
--   * prompt_version: the existing LLM_CONTROL_MATCHER_PROMPT_VERSION constant.
--     Bumping it globally invalidates. A source-digest test fails the build if
--     the prompt or model changes without a bump.
--
-- STATE — only 'answered' is reusable (operator ruling, 2026-08-18).
--   answered      — a parseable verdict (an EMPTY match list is a real, reusable
--                   answer: "no controls match" cost money to learn).
--   unparseable   — the model replied but failed the parse/validate contract.
--                   Persisted for observability; NEVER satisfies a lookup; retryable.
--   failed        — provider/transport fault. The model never really answered.
--                   NEVER satisfies a lookup; retryable.
--   dead_lettered — retry budget exhausted. Visible and human-actionable; never
--                   reused, never auto-retried, and explicitly NOT a cached
--                   negative verdict.
--   pending       — an in-flight reservation for stampede control.
-- Keeping 'unparseable' and 'failed' distinct is what gives provider faults and
-- model-response faults separate telemetry rather than one blurred "error".
--
-- PAYLOAD — diagnostics only. No prompt, no control names, no response body, no
-- signal summary; the signal is referenced by hash alone. response_sha256 lets
-- identical malformed responses be grouped with a GROUP BY while retaining zero
-- characters of content. This minimisation is what makes the category-D
-- classification (below) unconditionally correct.
--
-- GOVERNANCE — category D in dataClassification.ts ("org data not tied to a
-- specific user"): always covered by ORGANIZATION erasure, never part of an
-- individual's Art. 15 self-export, left alone by user deletion. That is the
-- operator's ruling expressed in the vocabulary the codebase already enforces,
-- with no special-case deletion logic. Retention is a TDG governed class
-- ('llm_verdict_cache'), for storage hygiene only — expiry costs a recompute,
-- never a wrong answer.
--
-- CHANNEL — read AND written on the TENANT channel inside withTenant, exactly
-- like signal_match_suggestions on the same code path, so RLS enforces the org
-- scoping rather than the application alone. It therefore takes an app_request
-- GRANT. (The M1-G2 lesson applies in reverse here: classify from EVERY
-- consumer. This table's only consumers are the matcher's tenant-channel path
-- and org-level erasure — it is category D, so the GDPR exporter, which walks
-- category B on the tenant channel, never touches it.)

CREATE TABLE IF NOT EXISTS llm_control_matcher_verdicts (
  organization_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_dedup_hash        TEXT        NOT NULL,
  control_inventory_digest TEXT        NOT NULL,
  prompt_version           TEXT        NOT NULL,

  state                    TEXT        NOT NULL
    CHECK (state IN ('pending', 'answered', 'unparseable', 'failed', 'dead_lettered')),

  -- The reusable verdict. NULL unless state = 'answered'. A cache of a DERIVED
  -- answer, not a canonical domain object — the canonical suggestions live in
  -- signal_match_suggestions. Truncating this table costs money, never truth.
  verdict                  JSONB,

  -- What actually answered, and what it cost — so a cache HIT can report the
  -- exact spend it avoided instead of a modelled guess.
  model                    TEXT,
  input_tokens             INTEGER,
  output_tokens            INTEGER,

  -- Diagnostics. Deliberately content-free (see PAYLOAD above).
  failure_class            TEXT,
  provider_status          INTEGER,
  parse_error_code         TEXT,
  response_sha256          TEXT,
  response_chars           INTEGER,

  attempts                 INTEGER     NOT NULL DEFAULT 0,
  max_attempts             INTEGER     NOT NULL DEFAULT 3,
  last_attempt_at          TIMESTAMPTZ,
  next_attempt_at          TIMESTAMPTZ,
  reserved_at              TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (organization_id, signal_dedup_hash, control_inventory_digest, prompt_version)
);

-- Miss-reason attribution: on a miss, one indexed probe answers "is there a row
-- for this org+signal under a DIFFERENT control digest / prompt version?" —
-- i.e. did control churn or a prompt bump cost us this call, or had we simply
-- never seen this signal. The probe runs only on the miss path, where an LLM
-- call is about to happen anyway.
CREATE INDEX IF NOT EXISTS idx_llm_verdicts_org_signal
  ON llm_control_matcher_verdicts (organization_id, signal_dedup_hash);

-- Retention sweep + dead-letter backlog review.
CREATE INDEX IF NOT EXISTS idx_llm_verdicts_created_at
  ON llm_control_matcher_verdicts (created_at);
CREATE INDEX IF NOT EXISTS idx_llm_verdicts_state
  ON llm_control_matcher_verdicts (state) WHERE state IN ('pending', 'dead_lettered');

ALTER TABLE llm_control_matcher_verdicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_control_matcher_verdicts_tenant_isolation ON llm_control_matcher_verdicts;
CREATE POLICY llm_control_matcher_verdicts_tenant_isolation ON llm_control_matcher_verdicts
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- No DELETE: the matcher never deletes verdicts. Retention and erasure run on
-- the elevated/owner channel, so withholding DELETE here keeps the request-path
-- role unable to destroy cache state.
GRANT SELECT, INSERT, UPDATE ON llm_control_matcher_verdicts TO app_request;
