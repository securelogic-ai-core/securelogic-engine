/**
 * applicabilityReassessment.ts — R3 (Slice 7): the ENQUEUE side of the live
 * signal→platform linkage. Producers call `enqueueApplicabilityReassessment`
 * at the three change points the S7 core reasons over:
 *
 *   signal_changed  — processSignal (cyberSignalProcessingService), after the
 *                     matcher, on the SAME client/tx — the job is enqueued iff
 *                     the signal processing commits.
 *   entity_changed  — ECL entity PATCH/DELETE handlers (enterpriseEntities.ts),
 *                     inside the asTenant tx — atomic with the mutation.
 *   edge_changed    — ECL relationship POST/DELETE handlers, one event per
 *                     edge ENDPOINT (an edge touches two nodes; planReassessment
 *                     matches single changed nodes).
 *
 * SELF-GATING: a no-op (zero DB access) unless enterpriseContextEnabled() —
 * so wiring the call sites changes nothing while the ECL flag is off, and a
 * flag flip activates the pipeline with no redeploy of the callers.
 *
 * DEDUP: NOT EXISTS against QUEUED jobs with an identical (org, type, payload).
 * 'processing' jobs are deliberately NOT dedup targets — a job mid-flight may
 * have already read state older than this change, so a fresh queue entry is
 * required for correctness (the worker itself is idempotent via R2's
 * recommendation-key guards, so over-enqueueing is safe, under-enqueueing is not).
 *
 * Entity CREATE does not enqueue: a brand-new node cannot appear in any existing
 * assessment's target or blast radius (planReassessment would match nothing).
 * Its first assessment arrives via the signal path once a signal matches it.
 */

import type { ChangeEvent } from "../../engine/applicability/v1/reassessment.js";
import type { Queryable } from "./applicabilityAssessmentWriter.js";
import { enterpriseContextEnabled } from "./enterpriseContextFeatureFlag.js";
import { logger } from "../infra/logger.js";

/** jobs.job_type for reassessment work. MUST equal the 20260731 CHECK literal. */
export const APPLICABILITY_REASSESS_JOB_TYPE = "applicability_reassess";

/**
 * Validate/parse a job payload back into a ChangeEvent. Returns null for any
 * malformed shape (the worker treats that as a non-retryable job failure).
 * Payloads are producer-written, but never trusted blindly (worker convention).
 */
export function parseChangeEvent(payload: unknown): ChangeEvent | null {
  if (payload === null || typeof payload !== "object") return null;
  const ev = (payload as { event?: unknown }).event;
  if (ev === null || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;
  if (e.type === "signal_changed") {
    return typeof e.signal_id === "string" && e.signal_id.length > 0
      ? { type: "signal_changed", signal_id: e.signal_id }
      : null;
  }
  if (e.type === "edge_changed" || e.type === "entity_changed") {
    if (
      typeof e.organization_id === "string" && e.organization_id.length > 0 &&
      typeof e.node_type === "string" && e.node_type.length > 0 &&
      typeof e.node_id === "string" && e.node_id.length > 0
    ) {
      return {
        type: e.type,
        organization_id: e.organization_id,
        node_type: e.node_type,
        node_id: e.node_id
      };
    }
    return null;
  }
  return null;
}

/**
 * Enqueue one reassessment job for `orgId`, deduped against identical queued
 * jobs. `db` is whatever channel the caller is already writing on (the shared
 * elevated client in processSignal; the tenant `pg` proxy in ECL handlers) so
 * the enqueue commits/rolls back WITH the triggering mutation.
 *
 * Returns the new job id, or null when skipped (flag off / deduped). A DB error
 * propagates into the caller's transaction (enqueue and mutation succeed or
 * fail TOGETHER — a silently-dropped enqueue would strand a stale assessment).
 */
export async function enqueueApplicabilityReassessment(
  db: Queryable,
  orgId: string,
  event: ChangeEvent
): Promise<string | null> {
  if (!enterpriseContextEnabled()) return null;

  const payload = JSON.stringify({ event });
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
    [orgId, APPLICABILITY_REASSESS_JOB_TYPE, payload]
  );
  const row = res.rows[0];
  const jobId = row ? String(row.id) : null;
  if (jobId) {
    logger.info(
      { event: "applicability_reassess_enqueued", orgId, jobId, changeType: event.type },
      "Applicability reassessment job enqueued"
    );
  }
  return jobId;
}
