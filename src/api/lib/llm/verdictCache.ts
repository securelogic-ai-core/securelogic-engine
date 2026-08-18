/**
 * verdictCache.ts — persistence for LLM control-matcher verdicts.
 *
 * All access is on the TENANT channel inside an existing withTenant scope (the
 * matcher's own), so RLS enforces the org scoping rather than the application
 * alone — the same channel signal_match_suggestions is written on, in the same
 * code path.
 *
 * The lookup/reserve/settle trio is split so the caller can COMMIT the
 * reservation before making the (multi-second) LLM call and settle it in a
 * separate scope afterwards. That is what makes cross-process stampede control
 * work at all — a reservation that never commits is invisible to the other two
 * matcher invocation sites (the hourly worker pipeline and the 15-minute KEV
 * poller) — and it also stops a tenant transaction being held open across an
 * LLM call.
 *
 * Design + rulings: docs/investigation/llm-verdict-cache-design{,-addendum}.md.
 */

import { pg } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";
import {
  isReusable,
  isRetryableNow,
  VERDICT_MAX_ATTEMPTS,
  type VerdictMissReason,
  type VerdictState
} from "./verdictCachePolicy.js";
import { recordVerdictCacheEvent } from "./verdictCacheMetrics.js";

export type VerdictKey = {
  organizationId: string;
  signalDedupHash: string;
  controlInventoryDigest: string;
  promptVersion: string;
};

export type CachedVerdict = {
  matches: Array<{ control_id: string; score: number; reasoning: string }>;
};

type VerdictRow = {
  state: VerdictState;
  verdict: CachedVerdict | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  reserved_at: Date | null;
};

export type VerdictLookup =
  | { outcome: "hit"; verdict: CachedVerdict; inputTokens: number; outputTokens: number; model: string | null }
  | { outcome: "miss"; reason: VerdictMissReason; attempts: number }
  | { outcome: "skip"; reason: "reserved_by_other" | "dead_lettered" };

/**
 * Look up a reusable verdict.
 *
 * Returns `hit` ONLY for state='answered' (operator ruling: unparseable is
 * persisted for observability but can never satisfy a lookup). `skip` means a
 * call must NOT be made and no suggestions are produced this pass — either
 * another process holds a live reservation, or the key is dead-lettered and
 * needs a human. `skip` is explicitly not "no matches": the caller writes
 * nothing rather than recording an empty verdict.
 */
export async function lookupVerdict(key: VerdictKey, now: Date = new Date()): Promise<VerdictLookup> {
  const startedAt = Date.now();

  const exact = await pg.query<VerdictRow>(
    `SELECT state, verdict, input_tokens, output_tokens, model,
            attempts, next_attempt_at, reserved_at
       FROM llm_control_matcher_verdicts
      WHERE organization_id = $1
        AND signal_dedup_hash = $2
        AND control_inventory_digest = $3
        AND prompt_version = $4`,
    [key.organizationId, key.signalDedupHash, key.controlInventoryDigest, key.promptVersion]
  );

  const row = exact.rows[0];

  if (row && isReusable(row.state) && row.verdict) {
    const result: VerdictLookup = {
      outcome: "hit",
      verdict: row.verdict,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      model: row.model
    };
    recordVerdictCacheEvent({
      kind: "hit",
      organizationId: key.organizationId,
      model: row.model,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      lookupMs: Date.now() - startedAt
    });
    return result;
  }

  if (row) {
    if (row.state === "dead_lettered") {
      recordVerdictCacheEvent({
        kind: "skip",
        organizationId: key.organizationId,
        reason: "dead_lettered",
        lookupMs: Date.now() - startedAt
      });
      return { outcome: "skip", reason: "dead_lettered" };
    }
    if (!isRetryableNow(row, now)) {
      // A live reservation held by another process, or a backoff not yet
      // elapsed. Either way: do not call, do not record an answer.
      recordVerdictCacheEvent({
        kind: "skip",
        organizationId: key.organizationId,
        reason: "reserved_by_other",
        lookupMs: Date.now() - startedAt
      });
      return { outcome: "skip", reason: "reserved_by_other" };
    }
    recordVerdictCacheEvent({
      kind: "miss",
      organizationId: key.organizationId,
      reason: "non_reusable_state",
      lookupMs: Date.now() - startedAt
    });
    return { outcome: "miss", reason: "non_reusable_state", attempts: row.attempts };
  }

  // No row for this exact key. Distinguish "never seen this signal" from
  // "we paid for this signal already, but the control inventory or the prompt
  // moved" — the number that reveals whether churn is destroying cache value.
  // One indexed probe, only on the miss path, where an LLM call follows anyway.
  const related = await pg.query<{ control_inventory_digest: string; prompt_version: string }>(
    `SELECT control_inventory_digest, prompt_version
       FROM llm_control_matcher_verdicts
      WHERE organization_id = $1 AND signal_dedup_hash = $2
      LIMIT 5`,
    [key.organizationId, key.signalDedupHash]
  );

  let reason: VerdictMissReason = "absent";
  if (related.rows.length > 0) {
    reason = related.rows.some((r) => r.prompt_version !== key.promptVersion)
      ? "prompt_version_changed"
      : "control_inventory_changed";
  }

  recordVerdictCacheEvent({
    kind: "miss",
    organizationId: key.organizationId,
    reason,
    lookupMs: Date.now() - startedAt
  });
  return { outcome: "miss", reason, attempts: 0 };
}

/**
 * Claim the right to compute this verdict.
 *
 * `INSERT … ON CONFLICT DO NOTHING` makes exactly one caller the winner across
 * processes. A losing caller gets `false` and must skip the LLM call for this
 * pass — control suggestions are advisory and re-derived next pass, so skipping
 * defers work, while calling anyway would permanently waste money.
 *
 * The UPDATE arm re-claims a row whose reservation has gone stale or whose
 * backoff has elapsed, and increments `attempts` — so the retry budget is
 * consumed by *claims*, which is what makes exhaustion reachable even if a
 * process dies mid-call every time.
 *
 * MUST be committed before the LLM call (see the module header).
 */
export async function reserveVerdict(
  key: VerdictKey,
  now: Date = new Date(),
  reservationTimeoutMs: number
): Promise<{ claimed: boolean; attempts: number }> {
  const staleBefore = new Date(now.getTime() - reservationTimeoutMs);

  const result = await pg.query<{ attempts: number }>(
    `INSERT INTO llm_control_matcher_verdicts
       (organization_id, signal_dedup_hash, control_inventory_digest, prompt_version,
        state, attempts, max_attempts, reserved_at, last_attempt_at, updated_at)
     VALUES ($1, $2, $3, $4, 'pending', 1, $5, $6, $6, $6)
     ON CONFLICT (organization_id, signal_dedup_hash, control_inventory_digest, prompt_version)
     DO UPDATE SET
        state           = 'pending',
        attempts        = llm_control_matcher_verdicts.attempts + 1,
        reserved_at     = $6,
        last_attempt_at = $6,
        updated_at      = $6
      WHERE llm_control_matcher_verdicts.state NOT IN ('answered', 'dead_lettered')
        AND (
          (llm_control_matcher_verdicts.state = 'pending'
             AND (llm_control_matcher_verdicts.reserved_at IS NULL
                  OR llm_control_matcher_verdicts.reserved_at <= $7))
          OR (llm_control_matcher_verdicts.state IN ('failed', 'unparseable')
             AND (llm_control_matcher_verdicts.next_attempt_at IS NULL
                  OR llm_control_matcher_verdicts.next_attempt_at <= $6))
        )
      RETURNING attempts`,
    [
      key.organizationId,
      key.signalDedupHash,
      key.controlInventoryDigest,
      key.promptVersion,
      VERDICT_MAX_ATTEMPTS,
      now,
      staleBefore
    ]
  );

  const attempts = result.rows[0]?.attempts;
  if (attempts === undefined) return { claimed: false, attempts: 0 };
  return { claimed: true, attempts };
}

/** Persist a reusable answer. An EMPTY match list is a real answer worth caching. */
export async function recordAnsweredVerdict(
  key: VerdictKey,
  verdict: CachedVerdict,
  usage: { model: string; inputTokens: number; outputTokens: number },
  now: Date = new Date()
): Promise<void> {
  await pg.query(
    `UPDATE llm_control_matcher_verdicts
        SET state = 'answered', verdict = $5::jsonb,
            model = $6, input_tokens = $7, output_tokens = $8,
            failure_class = NULL, provider_status = NULL,
            parse_error_code = NULL, response_sha256 = NULL, response_chars = NULL,
            next_attempt_at = NULL, reserved_at = NULL, updated_at = $9
      WHERE organization_id = $1 AND signal_dedup_hash = $2
        AND control_inventory_digest = $3 AND prompt_version = $4`,
    [
      key.organizationId,
      key.signalDedupHash,
      key.controlInventoryDigest,
      key.promptVersion,
      JSON.stringify(verdict),
      usage.model,
      usage.inputTokens,
      usage.outputTokens,
      now
    ]
  );
}

/**
 * Persist a non-answer. Diagnostics only — no prompt, no response body, no
 * control names (see the migration's PAYLOAD note); `response_sha256` groups
 * identical malformed responses while retaining zero content.
 */
export async function recordFailedVerdict(
  key: VerdictKey,
  outcome: {
    state: Exclude<VerdictState, "answered" | "pending">;
    failureClass?: string | null;
    providerStatus?: number | null;
    parseErrorCode?: string | null;
    responseSha256?: string | null;
    responseChars?: number | null;
    nextAttemptAt: Date | null;
  },
  now: Date = new Date()
): Promise<void> {
  await pg.query(
    `UPDATE llm_control_matcher_verdicts
        SET state = $5, verdict = NULL,
            failure_class = $6, provider_status = $7,
            parse_error_code = $8, response_sha256 = $9, response_chars = $10,
            next_attempt_at = $11, reserved_at = NULL, updated_at = $12
      WHERE organization_id = $1 AND signal_dedup_hash = $2
        AND control_inventory_digest = $3 AND prompt_version = $4`,
    [
      key.organizationId,
      key.signalDedupHash,
      key.controlInventoryDigest,
      key.promptVersion,
      outcome.state,
      outcome.failureClass ?? null,
      outcome.providerStatus ?? null,
      outcome.parseErrorCode ?? null,
      outcome.responseSha256 ?? null,
      outcome.responseChars ?? null,
      outcome.nextAttemptAt,
      now
    ]
  );

  if (outcome.state === "dead_lettered") {
    // The "fail visibly" half of the retry ruling: exhaustion is an alertable
    // event and a durable, queryable row — never a cached negative verdict.
    logger.error(
      {
        event: "llm_verdict_retry_exhausted",
        organizationId: key.organizationId,
        signal_dedup_hash: key.signalDedupHash,
        prompt_version: key.promptVersion,
        failure_class: outcome.failureClass ?? null,
        parse_error_code: outcome.parseErrorCode ?? null
      },
      "LLM control-matcher verdict dead-lettered after exhausting its retry budget — control suggestions for this signal are NOT suppressed silently; this needs a human"
    );
    recordVerdictCacheEvent({ kind: "retry_exhausted", organizationId: key.organizationId });
  }
}
