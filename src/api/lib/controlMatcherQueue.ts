/**
 * controlMatcherQueue.ts — the ENQUEUE side of asynchronous LLM control-suggestion
 * generation.
 *
 * WHY
 * ---
 * The LLM control matcher used to run INLINE inside `processSignal` (phase 7):
 * one awaited provider call per Critical/High signal per org, strictly
 * sequential. Measured on staging 2026-08-18, the slowest org spent 87.6% of
 * its 3.15-hour runtime inside those calls — while the weekly Brief scheduler's
 * overlap lock was held and every other org waited. Brief generation reads
 * `cyber_signals`; it never reads `signal_match_suggestions`. The Brief was
 * therefore blocked for hours on work it does not consume.
 *
 * This module makes the work a durable job instead. The matcher's behaviour and
 * the rows it writes are unchanged — only WHERE and WHEN it executes.
 *
 * ENQUEUE IS TRANSACTIONAL, AND THAT IS THE POINT
 * -----------------------------------------------
 * Producers pass the SAME client/tx that is committing the signal's processing,
 * exactly as `enqueueApplicabilityReassessment` does. The job is created iff
 * that processing commits. Enqueueing after the commit would open a window in
 * which the signal is marked `processed = TRUE` while no job exists — and
 * because re-ingest hits `ON CONFLICT DO NOTHING` and never re-processes, the
 * suggestion would be lost permanently with nothing to detect it.
 *
 * SELF-GATING
 * -----------
 * `shouldRunControlMatcher` is evaluated at ENQUEUE time — the identical gate
 * the inline call used (flag + control-relevant signal type + Critical/High).
 * It touches no database and costs nothing, so with the flag off this is a pure
 * no-op and no rows are written. Eligibility is therefore decided exactly once,
 * by exactly the same predicate as before.
 *
 * IDEMPOTENCY, IN TWO LAYERS
 * --------------------------
 * 1. Here: `NOT EXISTS` against a QUEUED job for the same (org, signal), so a
 *    re-ingested or re-swept signal does not stack duplicate jobs.
 * 2. In the worker: the verdict cache's reservation. Layer 1 cannot cover a job
 *    already `processing`, nor two producers racing across processes — layer 2
 *    does, because `reserveVerdict`'s `INSERT … ON CONFLICT` makes exactly one
 *    caller the winner and a loser skips the provider call entirely. Duplicate
 *    enqueues are therefore safe by design; missing enqueues are not, which is
 *    why layer 1 deliberately does NOT dedup against `processing` jobs.
 */

import type { SignalForControlMatch } from "./llmControlMatcher.js";
import { shouldRunControlMatcher } from "./llmControlMatcher.js";
import { logger } from "../infra/logger.js";

/** jobs.job_type for control-suggestion work. MUST equal the 20261024 CHECK literal. */
export const CONTROL_MATCHER_JOB_TYPE = "control_matcher_suggest";

/** The minimal surface this module needs from a pg client or pool. */
export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
};

/** Payload shape. Deliberately just the id — see parseControlMatcherPayload. */
export type ControlMatcherPayload = { signal_id: string };

/**
 * Validate/parse a job payload back into its signal id. Returns null for any
 * malformed shape (the worker treats that as a non-retryable job failure).
 *
 * The payload carries ONLY the signal id, not the signal's fields. The worker
 * re-reads the row inside a tenant scope, so a job can never act on a stale
 * copy of a summary or severity, and the dedup predicate above compares a small
 * stable value rather than a multi-kilobyte summary.
 */
export function parseControlMatcherPayload(payload: unknown): ControlMatcherPayload | null {
  if (payload === null || typeof payload !== "object") return null;
  const id = (payload as { signal_id?: unknown }).signal_id;
  return typeof id === "string" && id.length > 0 ? { signal_id: id } : null;
}

/**
 * Enqueue control-suggestion work for one (org, signal).
 *
 * Returns the new job id, or null when nothing was enqueued — either the signal
 * is ineligible (the same gate the inline call applied) or an identical job is
 * already queued. Never throws: a queue failure must not roll back the signal
 * processing that is committing alongside it, exactly as the inline call was
 * non-fatal before.
 *
 * @param db     the client/tx committing the signal's processing
 * @param orgId  tenant that owns both the signal and the suggestions
 */
export async function enqueueControlMatcherJob(
  db: Queryable,
  orgId: string,
  signal: SignalForControlMatch
): Promise<string | null> {
  if (!shouldRunControlMatcher(signal)) return null;

  try {
    const payload = JSON.stringify({ signal_id: signal.id });
    const res = await db.query(
      `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
       SELECT $1::uuid, NULL, $2, $3::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM jobs j
           WHERE j.organization_id = $1::uuid
             AND j.job_type = $2
             AND j.status = 'queued'
             AND j.payload = $3::jsonb
        )
       RETURNING id`,
      [orgId, CONTROL_MATCHER_JOB_TYPE, payload]
    );
    const row = res.rows[0] as { id?: unknown } | undefined;
    const jobId = row ? String(row.id) : null;

    if (jobId) {
      logger.info(
        {
          event: "control_matcher_enqueued",
          organization_id: orgId,
          signal_id: signal.id,
          job_id: jobId,
          severity: signal.severity,
          signal_type: signal.signal_type
        },
        "Control-suggestion job enqueued"
      );
    }
    return jobId;
  } catch (err) {
    // Non-fatal by contract. The inline matcher swallowed its own failures and
    // never affected the caller; enqueueing must not be stricter than the call
    // it replaces, or moving the work off the critical path would have made the
    // critical path MORE fragile.
    logger.warn(
      { event: "control_matcher_enqueue_failed", organization_id: orgId, signal_id: signal.id, err },
      "Control-suggestion enqueue failed — suggestions deferred to a later pass, signal processing unaffected"
    );
    return null;
  }
}
