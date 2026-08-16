/**
 * provenanceJobs.ts — deferring an answer's provenance without deferring the answer.
 *
 * ── Why anything is deferred at all ─────────────────────────────────────────
 * Decomposition costs ~11x the answer in output tokens at ~85-100 tok/s
 * (measured, staging a2a0f49e). A 3,000-char answer needs ~97s of generation —
 * more than the entire interactive budget. Long answers were therefore never
 * citable on the request path, and the synchronous budget could only choose
 * which way they failed. This moves the work, not the deadline.
 *
 * ── The authorization property, stated precisely ────────────────────────────
 * The job carries the ANSWER and the AUTHORIZED TOOL RESULTS the answer was
 * built from. It carries no query, no filter, and no identity to act under,
 * because the worker never reads canonical data: everything it decomposes
 * already passed the ASK-A gate for the asking user, at the moment they asked.
 *
 * That is stronger than re-authorizing in the background. A worker that re-ran
 * the reads would need an identity, and any identity broad enough to serve
 * every tenant's jobs is broader than the user who asked — the exact
 * escalation this design refuses to create. Here there is no second
 * authorization decision, so there is none to get wrong.
 *
 * ── Fail open, always ───────────────────────────────────────────────────────
 * Enqueue failures are swallowed. Ask is a synchronous user-facing request and
 * the answer is already written; a queue that is down must cost citations, not
 * the answer. The turn then reads exactly as it did before this feature
 * existed — uncited, and honestly labelled so.
 */

import { pg, withTenant } from "../../infra/postgres.js";
import { logger } from "../../infra/logger.js";

/** The lifecycle the UI renders and the worker advances. */
export type ProvenanceStatus = "pending" | "complete" | "partial" | "failed";

/**
 * One authorized tool result, positionally aligned with the invocations
 * recorded for the same message. `data` is undefined for a denied or failed
 * call — the position is held so citation indices stay meaningful.
 */
export type FrozenToolPayload = { toolName: string; authorized: boolean; data: unknown };

/**
 * Freeze the turn's context, queue the job, and mark the message pending — all
 * or nothing, and in a tenant scope of its OWN.
 *
 * Atomicity matters because any partial outcome is a lie the UI renders: a
 * message marked pending with no job shows "processing" forever, and a job with
 * no context wakes up with nothing to do. `withTenant` already IS a transaction
 * (BEGIN, set_config, COMMIT), so the three writes commit together.
 *
 * Running it in a SEPARATE scope from the message insert is the subtler half.
 * Postgres aborts an entire transaction on any failed statement, so enqueuing
 * inside the caller's scope would mean a queue problem poisons the transaction
 * that is writing the ANSWER — catching the error would not save it, because
 * the caller's COMMIT would fail too. Deferring provenance must never be able to
 * lose the thing it is deferring provenance FOR.
 *
 * The cost of that separation is honest and small: a crash between the two
 * leaves a turn with no job and `provenance_status` NULL, which renders as an
 * ordinary uncited answer. That is the correct degradation — nothing claims to
 * be verified.
 */
export async function enqueueProvenanceJob(args: {
  organizationId: string;
  userId: string | null;
  messageId: string;
  answer: string;
  modelId: string;
  payloads: FrozenToolPayload[];
}): Promise<string | null> {
  try {
    return await withTenant(args.organizationId, async () => {
      const jobResult = await pg.query<{ id: string }>(
        `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
         VALUES ($1, $2, 'ask_provenance', $3::jsonb)
         RETURNING id`,
        [
          args.organizationId,
          args.userId,
          // The job payload carries IDENTIFIERS only. The customer risk data
          // lives in the context row, which is purged on completion; putting it
          // here would leave it in a queue table that outlives the work.
          JSON.stringify({ messageId: args.messageId }),
        ]
      );
      const jobId = jobResult.rows[0]!.id;

      await pg.query(
        `INSERT INTO ask_provenance_contexts
           (organization_id, message_id, job_id, tool_payloads, answer, model_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (message_id) DO NOTHING`,
        [
          args.organizationId,
          args.messageId,
          jobId,
          JSON.stringify(args.payloads),
          args.answer,
          args.modelId,
        ]
      );

      await pg.query(
        `UPDATE ask_messages
            SET provenance_status = 'pending'
          WHERE id = $1 AND organization_id = $2`,
        [args.messageId, args.organizationId]
      );

      return jobId;
    });
  } catch (err) {
    // See the header: citations are the thing that degrades, never the answer.
    logger.warn(
      {
        event: "ask_provenance_enqueue_failed",
        organizationId: args.organizationId,
        messageId: args.messageId,
        err,
      },
      "Could not queue deferred provenance — answer stands uncited"
    );
    return null;
  }
}

/**
 * Stamp a synchronous turn's outcome so every answer carries a lifecycle state,
 * not just the deferred ones.
 *
 * Without this the UI would have to infer verification from a non-empty claims
 * column, which cannot tell "decomposition produced nothing" from "the pass
 * never ran" — and would render the first as verified.
 */
export async function recordSynchronousProvenanceStatus(args: {
  organizationId: string;
  messageId: string;
  status: ProvenanceStatus;
}): Promise<void> {
  try {
    await pg.query(
      `UPDATE ask_messages
          SET provenance_status = $3
        WHERE id = $1 AND organization_id = $2`,
      [args.messageId, args.organizationId, args.status]
    );
  } catch (err) {
    logger.warn(
      { event: "ask_provenance_status_write_failed", messageId: args.messageId, err },
      "Could not record synchronous provenance status"
    );
  }
}
