/**
 * askProvenanceWorker.ts — decompose a long answer's claims after the fact.
 *
 * Claims `ask_provenance` jobs from the generic `jobs` table (FOR UPDATE SKIP
 * LOCKED, the same claim shape as vendorEvidenceAnalysisWorker) and, for one
 * assistant turn per job, runs the SAME provenance pass the synchronous path
 * runs — same prompt, same forced tool, same verifier — then attaches the
 * verified claims to the stored message.
 *
 * ── THE AUTHORIZATION PROPERTY ──────────────────────────────────────────────
 *
 * This worker issues NO canonical query. Not a filtered one, not a scoped one —
 * none. Everything it decomposes comes from `ask_provenance_contexts`, which
 * froze the authorized tool results at answer time, after they had already
 * passed the ASK-A gate for the asking user under that user's seat scope.
 *
 * That is a stronger guarantee than re-authorizing in the background, and it is
 * why the design is shaped this way. A worker that re-ran the reads would need
 * an identity to run them as, and any identity able to serve every tenant's
 * jobs is by definition broader than the user who asked — the escalation this
 * refuses to create. Here there is no second authorization decision, so there
 * is nothing to get wrong: the worker cannot widen scope, cannot see rows
 * created after the turn, and cannot see anything the user was denied.
 *
 * Tenant isolation is belt and braces on top: every read and write runs inside
 * `withTenant(organization_id)`, so RLS is enforcing even though the worker
 * already has nothing but its own job's row to reach for.
 *
 * ── Idempotency, because a retried job must not double-cite ─────────────────
 *
 * Claims are attached by an UPDATE guarded on `provenance_status = 'pending'`.
 * A reclaim after a commit, a duplicate enqueue, or a manual retry therefore
 * finds zero rows to update and exits as an idempotent success. The context row
 * is UNIQUE per message, so there is exactly one job's worth of input per turn
 * no matter how many jobs reference it.
 *
 * ── The context is purged the moment it is no longer needed ────────────────
 *
 * `tool_payloads` is the only place full tool output is ever written — the
 * audit ledger deliberately stores shape instead, to avoid doubling the blast
 * radius of a leak. It is nulled in the SAME statement batch that attaches the
 * claims, on every terminal path including failure.
 */

import Anthropic from "@anthropic-ai/sdk";

import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  decideFailureState,
} from "../lib/dataRightsWorkerPolicy.js";
import { runProvenancePass } from "../lib/ask/provenancePass.js";
import type { FrozenToolPayload, ProvenanceStatus } from "../lib/ask/provenanceJobs.js";

export const ASK_PROVENANCE_JOB_TYPES = ["ask_provenance"] as const;

/**
 * The worker's own budget, sized against the two real constraints.
 *
 * Generous compared with the interactive path — that is the entire point of
 * moving the work — but bounded BELOW `LOCK_TIMEOUT_MS` (15 min), because a job
 * still running when its visibility timeout expires can be reclaimed by another
 * worker and decomposed twice. The idempotency guard makes that harmless to
 * correctness, but it is pure waste, so the deadline is set so it cannot
 * normally happen.
 *
 * Five minutes was the first value here and it was too small, which staging
 * proved immediately: an 8,543-char answer predicts ~23.5k output tokens ≈ 276s
 * of generation, and 5 min × 0.8 afforded only 20.4k — so the deferred job
 * refused for exactly the same reason the interactive path had, having moved
 * the work precisely to escape that. Twelve minutes affords ~49k tokens, which
 * matches the background output ceiling.
 */
const WORKER_DEADLINE_MS = 12 * 60 * 1000;

type JobRow = {
  id: string;
  organization_id: string;
  requested_by_user_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
};

const CLAIM_SQL = `
  UPDATE jobs
     SET status = 'processing',
         locked_by = $1,
         locked_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = (
     SELECT id FROM jobs
      WHERE job_type = ANY($2::text[])
        AND (
              (status = 'queued' AND scheduled_for <= now())
           OR (status = 'processing' AND locked_at < now() - ($3::bigint * interval '1 millisecond'))
        )
      ORDER BY scheduled_for
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING id, organization_id, requested_by_user_id, job_type, status, attempts, max_attempts, payload`;

export async function claimNextProvenanceJob(workerId: string): Promise<JobRow | null> {
  const result = await pg.query<JobRow>(CLAIM_SQL, [
    workerId,
    [...ASK_PROVENANCE_JOB_TYPES],
    LOCK_TIMEOUT_MS,
  ]);
  return result.rows[0] ?? null;
}

type ContextRow = {
  message_id: string;
  answer: string;
  model_id: string;
  tool_payloads: FrozenToolPayload[] | null;
  provenance_status: string | null;
  question: string | null;
};

/**
 * Terminal write: attach claims, set the lifecycle state, and purge the frozen
 * payloads — one transaction, guarded on the pending state.
 *
 * The guard is the idempotency mechanism. Returns whether it actually applied,
 * so a duplicate run can be logged as the no-op it is rather than counted as
 * work.
 */
async function finalize(args: {
  organizationId: string;
  messageId: string;
  status: ProvenanceStatus;
  claims: unknown | null;
  renderedAnswer: string | null;
}): Promise<boolean> {
  return withTenant(args.organizationId, async () => {
    const updated = await pg.query(
      `UPDATE ask_messages
          SET claims = COALESCE($3::jsonb, claims),
              content = COALESCE($4, content),
              provenance_status = $5
        WHERE id = $1
          AND organization_id = $2
          AND provenance_status = 'pending'`,
      [
        args.messageId,
        args.organizationId,
        args.claims === null ? null : JSON.stringify(args.claims),
        args.renderedAnswer,
        args.status,
      ]
    );

    // Purge regardless of whether this run won the race: if another run already
    // finalized, the payloads are dead weight either way and must not linger.
    await pg.query(
      `UPDATE ask_provenance_contexts
          SET tool_payloads = NULL, purged_at = now()
        WHERE message_id = $1 AND organization_id = $2 AND purged_at IS NULL`,
      [args.messageId, args.organizationId]
    );

    return (updated.rowCount ?? 0) > 0;
  });
}

export type ProvenanceJobDeps = {
  client?: Pick<Anthropic, "messages">;
};

export async function processClaimedProvenanceJob(
  job: JobRow,
  deps: ProvenanceJobDeps = {}
): Promise<void> {
  const messageId = (job.payload as { messageId?: unknown } | null)?.messageId;
  if (typeof messageId !== "string") {
    await recordFailure(
      job,
      new NonRetryableJobError("ask_provenance job payload missing a string messageId")
    );
    return;
  }

  // Everything the job may read, read once, inside the tenant scope. The join to
  // ask_messages carries the question so the model sees the turn it is
  // decomposing; both rows are already scoped to this org by RLS.
  const context = await withTenant(job.organization_id, async () => {
    const res = await pg.query<ContextRow>(
      `SELECT c.message_id,
              c.answer,
              c.model_id,
              c.tool_payloads,
              m.provenance_status,
              (SELECT q.content
                 FROM ask_messages q
                WHERE q.conversation_id = m.conversation_id
                  AND q.role = 'user'
                  AND q.created_at <= m.created_at
                ORDER BY q.created_at DESC
                LIMIT 1) AS question
         FROM ask_provenance_contexts c
         JOIN ask_messages m ON m.id = c.message_id
        WHERE c.message_id = $1 AND c.organization_id = $2`,
      [messageId, job.organization_id]
    );
    return res.rows[0] ?? null;
  });

  if (!context) {
    // The turn was deleted (or its tenant erased) before the job ran. Nothing to
    // do and nothing to retry.
    await recordSuccess(job, { skipped: "context_missing" });
    return;
  }

  if (context.provenance_status !== "pending") {
    // Already finalized by an earlier run. The guard in finalize() would catch
    // this anyway; checking first avoids paying for a model call to discover it.
    logger.info(
      { event: "ask_provenance_job_already_finalized", jobId: job.id, messageId },
      "Provenance job found its message already finalized — idempotent no-op"
    );
    await recordSuccess(job, { skipped: "already_finalized" });
    return;
  }

  const payloads = Array.isArray(context.tool_payloads) ? context.tool_payloads : [];
  if (payloads.length === 0) {
    // No authorized retrieval to cite against. Not a failure of decomposition —
    // there is simply nothing an observed claim could point at.
    await finalize({
      organizationId: job.organization_id,
      messageId,
      status: "failed",
      claims: null,
      renderedAnswer: null,
    });
    await recordSuccess(job, { outcome: "no_retrieval" });
    return;
  }

  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startedAt = Date.now();

  const result = await runProvenancePass({
    client,
    model: context.model_id,
    // A minimal, faithful reconstruction of the turn: the question that was
    // asked and the answer that was given. The worker deliberately does not
    // rebuild the full system prompt — it would have to guess the requester's
    // entitlement class, and the decomposition instruction is self-contained.
    systemPrompt:
      "You are decomposing an answer that has already been delivered to a user. " +
      "Do not revise it, extend it, or answer anything new.",
    messages: [{ role: "user", content: context.question ?? "(question unavailable)" }],
    answer: context.answer,
    invocations: payloads.map((p) => ({
      toolName: p.toolName,
      authorized: p.authorized,
      data: p.data,
    })),
    msRemaining: WORKER_DEADLINE_MS,
    // Raises the output ceiling and streams the call. Without it the job
    // inherits the INTERACTIVE limits it was created to escape — which is
    // exactly how the first staging run failed, refusing an 8,543-char answer
    // as "too costly" inside a five-minute budget.
    background: true,
  });

  const elapsedMs = Date.now() - startedAt;

  if (!result) {
    // The pass failed open, as it always does. Visible as `failed` rather than
    // silently uncited: an answer nobody could verify must not read like one
    // that was verified and found clean.
    const applied = await finalize({
      organizationId: job.organization_id,
      messageId,
      status: "failed",
      claims: null,
      renderedAnswer: null,
    });
    logger.warn(
      { event: "ask_provenance_job_no_claims", jobId: job.id, messageId, applied, elapsedMs },
      "Deferred provenance produced no claims — turn marked failed"
    );
    await recordSuccess(job, { outcome: "failed", elapsedMs });
    return;
  }

  // `clean` is the verifier's verdict on whether every observed claim held up.
  // A turn with downgraded claims IS cited, but not fully verified, and the two
  // must not render identically.
  const status: ProvenanceStatus = result.clean ? "complete" : "partial";

  const applied = await finalize({
    organizationId: job.organization_id,
    messageId,
    status,
    claims: result.claims,
    // DELIBERATELY NOT result.renderedAnswer.
    //
    // The synchronous path re-renders the answer from verified claims, so an
    // unsubstantiated sentence arrives prefixed "Assessment:" — safe there,
    // because the user has not seen the answer yet when it happens.
    //
    // Here they have. Rewriting the stored content would mean an answer someone
    // read at 12:04 says something different at 12:06, and it is not a
    // cosmetic difference: the first staging run of this path shortened a
    // 7,776-char answer to 7,198 — 578 characters, 7% of it, silently removed
    // from a document a user may already have acted on or quoted. An answer
    // that changes after delivery is a worse failure than one whose downgraded
    // claims are labelled only in the provenance panel, which is where the
    // `partial` state and every claim_class are shown anyway.
    renderedAnswer: null,
  });

  logger.info(
    {
      event: "ask_provenance_job_complete",
      jobId: job.id,
      messageId,
      status,
      applied,
      claims: result.claims.length,
      downgraded: result.issues.length,
      answerChars: context.answer.length,
      elapsedMs,
    },
    "Deferred provenance attached"
  );

  await recordSuccess(job, { outcome: status, claims: result.claims.length, elapsedMs });
}

async function recordSuccess(job: JobRow, result: Record<string, unknown>): Promise<void> {
  await pg.query(
    `UPDATE jobs
        SET status = 'succeeded', result = $2::jsonb, error = NULL,
            locked_by = NULL, locked_at = NULL,
            completed_at = now(), updated_at = now()
      WHERE id = $1`,
    [job.id, JSON.stringify(result)]
  );
}

async function recordFailure(job: JobRow, err: unknown): Promise<void> {
  const decision = decideFailureState(job, err, new Date());
  await pg.query(
    `UPDATE jobs
        SET status = $2, error = $3, next_attempt_at = $4,
            scheduled_for = COALESCE($4, scheduled_for),
            locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE id = $1`,
    [
      job.id,
      decision.status,
      err instanceof Error ? err.message : String(err),
      decision.nextAttemptAt,
    ]
  );

  // A job that will never run again must stop the turn saying "processing" —
  // it is uncited, permanently, and has to say so. BOTH terminal states count:
  // 'failed' (non-retryable) strands the message exactly as 'dead_lettered'
  // (out of attempts) does, and handling only the latter would leave a
  // permanently pending turn promising citations that are never coming.
  if (decision.status === "dead_lettered" || decision.status === "failed") {
    const messageId = (job.payload as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId === "string") {
      await finalize({
        organizationId: job.organization_id,
        messageId,
        status: "failed",
        claims: null,
        renderedAnswer: null,
      });
    }
  }
}

export async function runProvenanceTick(
  deps: ProvenanceJobDeps & { shouldContinue?: () => boolean } = {}
): Promise<number> {
  const workerId = `ask-provenance-${process.pid}`;
  let processed = 0;

  while (deps.shouldContinue?.() ?? true) {
    const job = await claimNextProvenanceJob(workerId);
    if (!job) break;

    try {
      await processClaimedProvenanceJob(job, deps);
    } catch (err) {
      logger.warn(
        { event: "ask_provenance_job_failed", jobId: job.id, attempts: job.attempts, err },
        "Provenance job threw — scheduling retry"
      );
      await recordFailure(job, err);
    }
    processed += 1;
  }

  return processed;
}
