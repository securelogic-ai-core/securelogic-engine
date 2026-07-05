/**
 * applicabilityReassessmentWorker.ts — R3 (Slice 7): the LIVE signal→platform
 * linkage worker. Delivers the S7 DONE bar ("a changed signal re-evaluates its
 * linked entities") and the deferred "4d" live path noted under Item 3.
 *
 * Pipeline per claimed job (one job = one org + one ChangeEvent):
 *   1. plan   — pure `planReassessment(event, linked)` over the org's CURRENT
 *               assessments (latest per (signal, target), by `seq`). For a
 *               signal_changed event, targets suggested by the matcher that have
 *               NO assessment yet are added as FIRST-TIME items — this is how an
 *               assessment is born (the 4c writer's first live caller).
 *   2. assess — re-run the pure `ApplicabilityEngineV1` with the candidate
 *               rebuilt from the latest `signal_match_suggestions` row and a
 *               freshly-resolved `GraphNeighborhood` (AD-13: the resolver stays
 *               the single traversal authority; vendor/ai_system targets only).
 *   3. persist— `persistApplicabilityAssessment` (4c) — WORM, hash-chained.
 *   4. drift  — pure `detectDrift(prior, current)`.
 *   5. dispatch — if drifted AND `applicabilityWorkflowEnabled()`, the R2
 *               dispatcher applies the S6 recommendations (suggestion/finding/
 *               actions in the SAME tenant tx; AlertItems collected).
 *
 * Steps 1–5 + the job's terminal `succeeded` UPDATE all run inside ONE
 * `withTenant(job.organization_id)` transaction — work and completion commit
 * atomically. Alert emails flush AFTER commit via `createAlertBatcher`
 * (notifications outside the tx), and `writeAuditEvent` mirrors after commit.
 *
 * CLAIM: `FOR UPDATE SKIP LOCKED` on the ELEVATED channel — the data-rights /
 * vendor-extraction worker pattern verbatim (a context-less poller on the
 * tenant channel would see zero rows post-RLS-flip). Everything after the
 * claim is tenant-scoped.
 *
 * FLAG GATE: `runOneTick` refuses to claim unless `enterpriseContextEnabled()`
 * (idle-skip, never crash) — the vendor-extraction claim-gate precedent. The
 * DISPATCH step additionally requires `applicabilityWorkflowEnabled()`, so an
 * operator can run reassessment (fresh WORM decisions) without workflow writes.
 *
 * SCHEDULING: `startApplicabilityReassessmentWorker()` registers an in-process
 * node-cron tick (every minute) with an overlap guard — the engine-side
 * accountDeletionEnqueuer precedent. No new Render service; the queue is
 * durable, so a redeploy mid-job is reclaimed via the lock timeout.
 */

import { schedule } from "node-cron";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  APPLICABILITY_REASSESS_JOB_TYPE,
  parseChangeEvent
} from "../lib/applicabilityReassessment.js";
import { persistApplicabilityAssessment } from "../lib/applicabilityAssessmentWriter.js";
import {
  dispatchApplicabilityWorkflow,
  applicabilityWorkflowEnabled
} from "../lib/applicabilityWorkflowDispatcher.js";
import { enterpriseContextEnabled } from "../lib/enterpriseContextFeatureFlag.js";
import { resolveNeighborhood, DEFAULT_DEPTH } from "../lib/enterpriseGraphResolver.js";
import { createAlertBatcher, type AlertItem } from "../lib/alerting/alertService.js";
import {
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  decideFailureState
} from "../lib/dataRightsWorkerPolicy.js";
import { ApplicabilityEngineV1 } from "../../engine/applicability/v1/ApplicabilityEngineV1.js";
import {
  planReassessment,
  detectDrift,
  type ChangeEvent,
  type LinkedAssessment,
  type ReassessmentItem
} from "../../engine/applicability/v1/reassessment.js";
import type { StoredAssessment } from "../../engine/applicability/v1/explainability.js";
import type {
  MatcherCandidate,
  MatchTargetType,
  ApplicabilityResult,
  GraphNeighborhood
} from "../../engine/applicability/v1/types.js";
import type { EvidenceSnapshot } from "../../engine/applicability/v1/contentHash.js";
// EAR Phase 2: spec-driven graph-representability (replaces the local
// GRAPH_REPRESENTABLE hard-code — ARCHITECTURE.md §1.4 chokepoint 1, site B).
import { isGraphRepresentableTarget } from "../lib/assetRegistry.js";

/** Node type a registry backing kind resolves to in the ECL graph — 'asset'
 * targets seed neighborhood resolution at their BACKING node, where the org's
 * existing topology lives (asset-endpoint edges also traverse via the
 * vocabulary-agnostic resolver, but the backing node is the reliable seed). */
const BACKING_KIND_NODE_TYPE: Record<string, string> = {
  vendors: "vendor",
  ai_systems: "ai_system",
  enterprise_entities: "enterprise_entity"
};

/** Hard cap on items processed per job — a runaway plan is split across retries, not unbounded. */
export const MAX_ITEMS_PER_JOB = 200;

export interface JobRow {
  id: string;
  organization_id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
}

export interface WorkerDeps {
  now?: () => Date;
  workerId?: string;
  /** Loop guard: runOneTick stops claiming when this returns false (shutdown). */
  shouldContinue?: () => boolean;
}

const CLAIM_SQL = `
  UPDATE jobs
     SET status = 'processing',
         locked_by = $1,
         locked_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = (
     SELECT id FROM jobs
      WHERE job_type = $2
        AND (
              (status = 'queued' AND scheduled_for <= now())
           OR (status = 'processing' AND locked_at < now() - ($3::bigint * interval '1 millisecond'))
        )
      ORDER BY scheduled_for
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING id, organization_id, job_type, status, attempts, max_attempts, payload`;

export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  const { rows } = await pgElevated.query(CLAIM_SQL, [
    workerId,
    APPLICABILITY_REASSESS_JOB_TYPE,
    LOCK_TIMEOUT_MS
  ]);
  return (rows[0] as JobRow | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Tenant-scoped loaders (all run inside withTenant via the pg proxy)
// ---------------------------------------------------------------------------

/** The org's CURRENT assessments (latest per (signal, target) by seq) + blast radii. */
async function loadLinkedAssessments(orgId: string): Promise<Array<LinkedAssessment & { assessment_id: string; header: StoredAssessment }>> {
  const heads = await pg.query(
    `SELECT DISTINCT ON (signal_id, target_type, target_id)
            id, signal_id, target_type, target_id, decision, confidence,
            confidence_band, reasoning_steps, engine_version, schema_version,
            content_hash, prev_hash
       FROM applicability_assessments
      WHERE organization_id = $1
      ORDER BY signal_id, target_type, target_id, seq DESC`,
    [orgId]
  );
  if (heads.rows.length === 0) return [];

  const ids = heads.rows.map((r) => String((r as Record<string, unknown>).id));
  const affected = await pg.query(
    `SELECT assessment_id, node_type, node_id, min_depth, via_target_type, via_target_id
       FROM applicability_affected_entities
      WHERE organization_id = $1 AND assessment_id = ANY($2::uuid[])`,
    [orgId, ids]
  );
  const byAssessment = new Map<string, Array<{ node_type: string; node_id: string; min_depth: number; via_target_type: string; via_target_id: string }>>();
  for (const raw of affected.rows) {
    const a = raw as Record<string, unknown>;
    const key = String(a.assessment_id);
    if (!byAssessment.has(key)) byAssessment.set(key, []);
    byAssessment.get(key)!.push({
      node_type: String(a.node_type),
      node_id: String(a.node_id),
      min_depth: Number(a.min_depth),
      via_target_type: String(a.via_target_type),
      via_target_id: String(a.via_target_id)
    });
  }

  return heads.rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const assessmentId = String(r.id);
    const nodes = byAssessment.get(assessmentId) ?? [];
    const header: StoredAssessment = {
      organization_id: orgId,
      signal_id: String(r.signal_id),
      target_type: String(r.target_type) as MatchTargetType,
      target_id: String(r.target_id),
      decision: r.decision as StoredAssessment["decision"],
      confidence: Number(r.confidence),
      confidence_band: r.confidence_band as StoredAssessment["confidence_band"],
      reasoning_steps: (Array.isArray(r.reasoning_steps) ? r.reasoning_steps : []) as StoredAssessment["reasoning_steps"],
      affected_entities: nodes.map((n) => ({
        node_type: n.node_type,
        node_id: n.node_id,
        min_depth: n.min_depth,
        via_target_type: n.via_target_type as MatchTargetType,
        via_target_id: n.via_target_id
      })),
      // Prior evidence rows are not needed by detectDrift/dispatch; loading them
      // per-head would be an N+1 for no consumer. Kept empty BY CONTRACT here.
      evidence: [],
      engine_version: String(r.engine_version),
      schema_version: String(r.schema_version),
      content_hash: String(r.content_hash),
      prev_hash: String(r.prev_hash)
    };
    return {
      assessment_id: assessmentId,
      organization_id: orgId,
      signal_id: header.signal_id,
      target_type: header.target_type,
      target_id: header.target_id,
      affected: nodes.map((n) => ({ node_type: n.node_type, node_id: n.node_id })),
      header
    };
  });
}

/** First-time items for a signal_changed event: matcher-suggested targets with no assessment yet. */
async function loadFirstTimeItems(
  orgId: string,
  signalId: string,
  existing: Array<{ signal_id: string; target_type: string; target_id: string }>
): Promise<ReassessmentItem[]> {
  const suggestions = await pg.query(
    `SELECT DISTINCT target_type, target_id
       FROM signal_match_suggestions
      WHERE organization_id = $1 AND signal_id = $2`,
    [orgId, signalId]
  );
  const seen = new Set(existing.filter((e) => e.signal_id === signalId).map((e) => `${e.target_type}|${e.target_id}`));
  const items: ReassessmentItem[] = [];
  for (const raw of suggestions.rows) {
    const s = raw as Record<string, unknown>;
    const tt = String(s.target_type) as MatchTargetType;
    const tid = String(s.target_id);
    if (seen.has(`${tt}|${tid}`)) continue;
    items.push({
      organization_id: orgId,
      signal_id: signalId,
      target_type: tt,
      target_id: tid,
      reason: "initial_assessment"
    });
  }
  return items.sort((a, b) => (`${a.target_type}|${a.target_id}` < `${b.target_type}|${b.target_id}` ? -1 : 1));
}

/** Rebuild the matcher candidate for one (signal, target) from the latest suggestion row. */
async function loadCandidate(
  orgId: string,
  item: ReassessmentItem
): Promise<{ candidate: MatcherCandidate; suggestionId: string | null }> {
  const res = await pg.query(
    `SELECT s.id, s.match_score, s.match_reason, s.asset_id, a.asset_type
       FROM signal_match_suggestions s
       LEFT JOIN assets a ON a.id = s.asset_id AND a.organization_id = s.organization_id
      WHERE s.organization_id = $1 AND s.signal_id = $2 AND s.target_type = $3 AND s.target_id = $4
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [orgId, item.signal_id, item.target_type, item.target_id]
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return {
    candidate: {
      target_type: item.target_type,
      target_id: item.target_id,
      match_score: row && row.match_score !== null && row.match_score !== undefined ? Number(row.match_score) : null,
      match_reason: row && typeof row.match_reason === "string" ? row.match_reason : "reassessment_no_suggestion",
      // EAR Phase 2: present only for 'asset' targets — drives the engine's
      // spec-based graph-representability.
      asset_type: row && typeof row.asset_type === "string" ? row.asset_type : null,
      asset_id: row && typeof row.asset_id === "string" ? row.asset_id : null
    },
    suggestionId: row ? String(row.id) : null
  };
}

// ---------------------------------------------------------------------------
// Per-item reassess → persist → drift → dispatch
// ---------------------------------------------------------------------------

export interface ItemOutcome {
  signal_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  decision: string;
  drifted: boolean;
  drift_kind: string;
  dispatched: boolean;
  assessment_id: string;
}

async function reassessItem(
  orgId: string,
  item: ReassessmentItem,
  prior: StoredAssessment | null,
  alerts: AlertItem[]
): Promise<ItemOutcome> {
  const { candidate, suggestionId } = await loadCandidate(orgId, item);

  let neighborhood: GraphNeighborhood | undefined;
  if (isGraphRepresentableTarget(item.target_type, candidate.asset_type ?? null)) {
    if (item.target_type === "asset") {
      // Seed at the backing node (see BACKING_KIND_NODE_TYPE), and hand the
      // engine the same graph identity so its BFS roots where the org's
      // edges actually are (candidate.graph_node).
      const backing = await pg.query(
        `SELECT backing_kind, backing_id FROM assets WHERE id = $1 AND organization_id = $2`,
        [item.target_id, orgId]
      );
      const b = backing.rows[0] as { backing_kind: string; backing_id: string } | undefined;
      const nodeType = b ? BACKING_KIND_NODE_TYPE[b.backing_kind] : undefined;
      if (b && nodeType) {
        candidate.graph_node = { node_type: nodeType, node_id: b.backing_id };
        neighborhood = await resolveNeighborhood(orgId, nodeType, b.backing_id, DEFAULT_DEPTH);
      }
    } else {
      neighborhood = await resolveNeighborhood(orgId, item.target_type, item.target_id, DEFAULT_DEPTH);
    }
  }

  const result: ApplicabilityResult = ApplicabilityEngineV1.assess({
    signalId: item.signal_id,
    candidates: [candidate],
    ...(neighborhood ? { neighborhood } : {})
  });

  const evidence: EvidenceSnapshot[] = [
    {
      evidence_type: "match_candidate",
      ref_table: "signal_match_suggestions",
      ref_id: suggestionId,
      captured_value: JSON.stringify(candidate),
      weight: candidate.match_score
    },
    {
      evidence_type: "graph_neighborhood",
      ref_table: "enterprise_relationships",
      ref_id: null,
      captured_value: JSON.stringify(
        neighborhood
          ? { root: neighborhood.root, depth: neighborhood.depth, nodes: neighborhood.nodes.length, edges: neighborhood.edges.length }
          : { absent: true, reason: "target_not_graph_representable" }
      ),
      weight: null
    },
    {
      evidence_type: "reassessment_trigger",
      ref_table: "jobs",
      ref_id: null,
      captured_value: JSON.stringify({ reason: item.reason }),
      weight: null
    }
  ];

  const identity = {
    organization_id: orgId,
    signal_id: item.signal_id,
    target_type: item.target_type,
    target_id: item.target_id
  };
  const persisted = await persistApplicabilityAssessment(pg, {
    identity,
    result,
    evidence,
    assetId: candidate.asset_id ?? null
  });

  const current: StoredAssessment = {
    ...identity,
    decision: result.decision,
    confidence: result.confidence,
    confidence_band: result.confidence_band,
    reasoning_steps: result.reasoning_steps,
    affected_entities: result.affected_entities,
    evidence,
    engine_version: result.engine_version,
    schema_version: result.schema_version,
    content_hash: persisted.contentHash,
    prev_hash: persisted.prevHash
  };

  const drift = detectDrift(prior, current);

  let dispatched = false;
  if (drift.drifted && applicabilityWorkflowEnabled()) {
    const dispatch = await dispatchApplicabilityWorkflow(pg, {
      assessmentId: persisted.assessmentId,
      stored: current
    });
    alerts.push(...dispatch.alerts);
    dispatched = dispatch.recommendations.length > 0;
  }

  return {
    signal_id: item.signal_id,
    target_type: item.target_type,
    target_id: item.target_id,
    reason: item.reason,
    decision: result.decision,
    drifted: drift.drifted,
    drift_kind: drift.kind,
    dispatched,
    assessment_id: persisted.assessmentId
  };
}

// ---------------------------------------------------------------------------
// Job processing
// ---------------------------------------------------------------------------

async function recordFailure(job: JobRow, err: unknown, now: Date): Promise<void> {
  const decision = decideFailureState(job, err, now);
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = $2, error = $3, next_attempt_at = $4,
              scheduled_for = COALESCE($4, scheduled_for),
              locked_by = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id, decision.status, message, decision.nextAttemptAt]
    );
  });
}

/**
 * Process one already-claimed job to completion. Never throws — every outcome
 * is persisted to the row (the data-rights/vendor-extraction discipline).
 */
export async function processClaimedJob(job: JobRow, deps: WorkerDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const orgId = job.organization_id;

  const event: ChangeEvent | null = parseChangeEvent(job.payload);
  if (!event) {
    await recordFailure(job, new NonRetryableJobError("applicability_reassess job payload is not a valid ChangeEvent"), now());
    logger.error(
      { event: "applicability_reassess_job_invalid_payload", job_id: job.id, org_id: orgId },
      "applicability-reassess job failed: malformed payload"
    );
    return;
  }

  const alerts: AlertItem[] = [];
  let outcomes: ItemOutcome[] = [];
  let truncated = 0;

  try {
    outcomes = await withTenant(orgId, async () => {
      const linked = await loadLinkedAssessments(orgId);
      const priorByKey = new Map(linked.map((l) => [`${l.signal_id}|${l.target_type}|${l.target_id}`, l.header]));

      const plan = planReassessment(event, linked);
      let items: ReassessmentItem[] = plan.items;
      if (event.type === "signal_changed") {
        items = [...items, ...(await loadFirstTimeItems(orgId, event.signal_id, linked))];
      }
      if (items.length > MAX_ITEMS_PER_JOB) {
        truncated = items.length - MAX_ITEMS_PER_JOB;
        items = items.slice(0, MAX_ITEMS_PER_JOB);
      }

      const results: ItemOutcome[] = [];
      for (const item of items) {
        const prior = priorByKey.get(`${item.signal_id}|${item.target_type}|${item.target_id}`) ?? null;
        results.push(await reassessItem(orgId, item, prior, alerts));
      }

      // Terminal success in the SAME tenant tx — work and completion are atomic.
      await pg.query(
        `UPDATE jobs
            SET status = 'succeeded', result = $2::jsonb, error = NULL,
                locked_by = NULL, locked_at = NULL,
                completed_at = now(), updated_at = now()
          WHERE id = $1`,
        [
          job.id,
          JSON.stringify({
            change_type: event.type,
            items: results.length,
            drifted: results.filter((r) => r.drifted).length,
            dispatched: results.filter((r) => r.dispatched).length,
            truncated
          })
        ]
      );
      return results;
    });
  } catch (err) {
    await recordFailure(job, err, now());
    logger.error(
      { event: "applicability_reassess_job_failed", job_id: job.id, org_id: orgId, changeType: event.type, err },
      "applicability-reassess job failed; failure state recorded"
    );
    return;
  }

  // ---- AFTER COMMIT: notifications (outside the tx) + audit mirror. ----
  if (alerts.length > 0) {
    const batcher = createAlertBatcher("critical_finding", "applicability-reassess");
    for (const item of alerts) batcher.add(orgId, item);
    await batcher.flush();
  }

  if (truncated > 0) {
    // Never silently cap: the dropped tail is re-enqueued as a fresh job by the
    // next change event; loudly record that this run did not cover everything.
    logger.warn(
      { event: "applicability_reassess_truncated", job_id: job.id, org_id: orgId, truncated },
      `applicability-reassess plan exceeded ${MAX_ITEMS_PER_JOB} items; ${truncated} item(s) not processed this job`
    );
  }

  writeAuditEvent({
    organizationId: orgId,
    eventType: "applicability.reassessed",
    resourceType: "applicability_assessment",
    resourceId: null,
    payload: {
      job_id: job.id,
      change_type: event.type,
      items: outcomes.length,
      drifted: outcomes.filter((o) => o.drifted).length,
      dispatched: outcomes.filter((o) => o.dispatched).length,
      alerts: alerts.length
    }
  });

  logger.info(
    {
      event: "applicability_reassess_job_complete",
      job_id: job.id,
      org_id: orgId,
      changeType: event.type,
      items: outcomes.length,
      drifted: outcomes.filter((o) => o.drifted).length,
      dispatched: outcomes.filter((o) => o.dispatched).length
    },
    "applicability-reassess job complete"
  );
}

/**
 * Drain the queue: claim + process until none claimable (or shutdown). Refuses
 * to claim while the ECL flag is off (idle-skip — the vendor-extraction
 * claim-gate precedent). Returns the number of jobs processed this tick.
 */
export async function runOneTick(deps: WorkerDeps = {}): Promise<number> {
  if (!enterpriseContextEnabled()) return 0;

  const workerId = deps.workerId ?? `applicability-reassess-${process.pid}`;
  let processed = 0;
  for (;;) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    const job = await claimNextJob(workerId);
    if (!job) break;
    await processClaimedJob(job, deps);
    processed += 1;
  }
  return processed;
}

/** True while a tick is in progress (overlap guard for the cron). */
let isTicking = false;

/**
 * Register the in-process worker cron (engine side): every minute, drain the
 * queue. Always registered; each tick self-gates on the ECL flag inside
 * runOneTick (zero DB access while off), so a flag flip takes effect on the
 * next tick with no redeploy — the accountDeletionEnqueuer precedent.
 */
export function startApplicabilityReassessmentWorker(): void {
  schedule("* * * * *", () => {
    if (isTicking) {
      logger.warn(
        { event: "applicability_reassess_tick_overlap_skipped" },
        "applicability-reassess worker: previous tick still running — skipping"
      );
      return;
    }
    isTicking = true;
    void runOneTick()
      .catch((err) => {
        logger.error(
          { event: "applicability_reassess_tick_error", err },
          "applicability-reassess worker tick failed"
        );
      })
      .finally(() => {
        isTicking = false;
      });
  });
  logger.info(
    { event: "applicability_reassess_worker_registered", schedule: "* * * * * (every minute)" },
    "Applicability reassessment worker registered (gated by SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED)"
  );
}
