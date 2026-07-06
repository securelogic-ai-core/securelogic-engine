/**
 * connectorSyncWorker.ts — EAR Phase 3b: the connector sync worker. Lights up
 * the nine dark R7 adapters (ARCHITECTURE.md §4 Phase 3): one job = one
 * (organization, connector) sync run.
 *
 * Pipeline per claimed job:
 *   1. load    — the org's enterprise_connectors row (tenant read); refuse
 *                (non-retryable) if missing, disabled, or undecryptable.
 *   2. fetch   — adapter.fetch() with the SSRF-safe production HttpClient
 *                (injectable for tests). OUTSIDE any transaction — network I/O
 *                never holds a DB tx open.
 *   3. plan    — pure planConnectorSync (category → detail assets vs import
 *                lane), then per import group: external_ref pre-dedup +
 *                planImport (the CSV planner — same validators, caps, name
 *                dedup).
 *   4. persist — createDetailAsset for detail inputs (Phase 3a shared path;
 *                external_ref/name conflicts count as already-synced),
 *                insertImportRow (provenance 'connector_sync') for ok rows,
 *                last_sync_* update + terminal `succeeded` — ALL in ONE
 *                withTenant transaction (work and completion atomic).
 *   5. audit   — writeAuditEvent mirrors after commit.
 *
 * CLAIM: FOR UPDATE SKIP LOCKED on the ELEVATED channel — the data-rights /
 * reassessment pattern verbatim. FLAG GATE: runOneTick refuses to claim unless
 * BOTH SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED (connectors are an ECL surface)
 * AND SECURELOGIC_ASSET_REGISTRY_ENABLED (syncs create registry assets) —
 * idle-skip, never crash. SCHEDULING: in-process node-cron tick every minute
 * with an overlap guard (the reassessment precedent). Relationships are
 * persisted since P7 (resolution by external_ref; ON CONFLICT-idempotent;
 * edge-cap-aware) — every skip is counted in the job result, never silent.
 */

import { schedule } from "node-cron";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enterpriseContextEnabled } from "../lib/enterpriseContextFeatureFlag.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { connectorScheduledSyncEnabled } from "../lib/connectorScheduledSyncFlag.js";
import { scheduleBackoffMinutes } from "../lib/connectorScheduleCore.js";
import {
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  decideFailureState
} from "../lib/dataRightsWorkerPolicy.js";
import { getConnector } from "../lib/connectors/registry.js";
import type { ConnectorAdapter, ConnectorCursor, HttpClient, NormalizedInventory } from "../lib/connectors/types.js";
import { buildConnectorHttpClient } from "../lib/connectorHttpClient.js";
import {
  getConnectorRow,
  decryptConnectorConfig,
  type ConnectorRow
} from "../lib/connectorConfigStore.js";
import {
  CONNECTOR_SYNC_JOB_TYPE,
  planConnectorSync,
  type ConnectorSyncPlan
} from "../lib/connectorSyncCore.js";
import { planObservations } from "../lib/connectorObservationCore.js";
import {
  countReappearing,
  upsertObservations,
  markDriftStale,
  type ReconcileSummary
} from "../lib/connectorObservationStore.js";
import { createDetailAsset } from "../lib/assetDetailPersistence.js";
import { planImport, type ImportEntityType, type ImportRow } from "../lib/enterpriseContextImport.js";
import {
  existingKeys,
  capHeadroom,
  existingExternalRefs,
  insertImportRow
} from "../lib/enterpriseImportPersistence.js";
import { enforceEnterpriseEdgeLimit } from "../lib/enterpriseEdgeLimit.js";
import { DETAIL_TABLE_SPEC } from "../lib/assetDetailValidation.js";

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
  /** Injectable HTTP surface — tests pass a fake; prod defaults to the SSRF-safe client. */
  http?: HttpClient;
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
  const { rows } = await pgElevated.query(CLAIM_SQL, [workerId, CONNECTOR_SYNC_JOB_TYPE, LOCK_TIMEOUT_MS]);
  return (rows[0] as JobRow | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Persistence (inside the tenant tx)
// ---------------------------------------------------------------------------

export interface SyncSummary {
  connector_id: string;
  /** E2.P2: 'full' saw the complete inventory (reconciles drift); 'delta' saw only changes. */
  sync_mode: "full" | "delta";
  detail_created: number;
  detail_existing: number;
  detail_cap_exceeded: number;
  imported: number;
  import_duplicate: number;
  import_invalid: number;
  import_cap_exceeded: number;
  already_synced: number;
  relationships_created: number;
  relationships_existing: number;
  relationships_unresolved: number;
  relationships_cap_skipped: number;
  relationships_self_dropped: number;
  truncated: number;
  /** E2.P2 discovery-ledger reconciliation (ERIP-AD-8/11). */
  observed: number;
  drift_stale: number;
  drift_reappeared: number;
}

// ---------------------------------------------------------------------------
// P7: relationship persistence — external_ref-keyed edges → enterprise_relationships
// ---------------------------------------------------------------------------

/** Graph endpoint a synced external_ref resolves to. */
type GraphRef = { node_type: string; node_id: string };

/**
 * Resolve external_refs to graph endpoints across every connector-writable
 * store: enterprise_entities rows ARE graph nodes ('enterprise_entity'); the
 * four detail tables' graph identity is their Tier-0 registry row
 * ('asset', asset_id — EAR-AD-4).
 */
async function resolveExternalRefs(orgId: string, refs: readonly string[]): Promise<Map<string, GraphRef>> {
  const out = new Map<string, GraphRef>();
  if (refs.length === 0) return out;
  const list = [...new Set(refs)];

  const entities = await pg.query<{ id: string; external_ref: string }>(
    `SELECT id, external_ref FROM enterprise_entities
      WHERE organization_id = $1 AND external_ref = ANY($2::text[])`,
    [orgId, list]
  );
  for (const r of entities.rows) out.set(r.external_ref, { node_type: "enterprise_entity", node_id: r.id });

  for (const spec of Object.values(DETAIL_TABLE_SPEC)) {
    const rows = await pg.query<{ asset_id: string | null; external_ref: string }>(
      `SELECT asset_id, external_ref FROM ${spec.table}
        WHERE organization_id = $1 AND external_ref = ANY($2::text[])`,
      [orgId, list]
    );
    for (const r of rows.rows) {
      if (r.asset_id) out.set(r.external_ref, { node_type: "asset", node_id: r.asset_id });
    }
  }
  return out;
}

/**
 * Persist the plan's relationships as enterprise_relationships edges.
 * Idempotent (ON CONFLICT DO NOTHING against the live-edge unique index — a
 * thrown 23505 would abort the tx); respects the per-org edge cap (headroom
 * computed once, remainder counted, never silent); unresolvable endpoints are
 * counted, never guessed.
 */
async function persistRelationships(
  orgId: string,
  connectorId: string,
  plan: ConnectorSyncPlan,
  summary: SyncSummary
): Promise<void> {
  summary.relationships_self_dropped = plan.relationshipsSelfDropped;
  if (plan.relationships.length === 0) return;

  const refs = plan.relationships.flatMap((r) => [r.from_external_ref, r.to_external_ref]);
  const resolved = await resolveExternalRefs(orgId, refs);

  const edgeLimit = await enforceEnterpriseEdgeLimit(orgId);
  let headroom = Math.max(0, edgeLimit.cap - edgeLimit.used);

  for (const rel of plan.relationships) {
    const from = resolved.get(rel.from_external_ref);
    const to = resolved.get(rel.to_external_ref);
    if (!from || !to) {
      summary.relationships_unresolved++;
      continue;
    }
    if (from.node_type === to.node_type && from.node_id === to.node_id) {
      // Distinct external_refs can resolve to one node — the CHECK would abort the tx.
      summary.relationships_self_dropped++;
      continue;
    }
    if (headroom <= 0) {
      summary.relationships_cap_skipped++;
      continue;
    }
    const inserted = await pg.query(
      `INSERT INTO enterprise_relationships (
         organization_id, from_type, from_id, to_type, to_id,
         relationship_type, note, created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [orgId, from.node_type, from.node_id, to.node_type, to.node_id, rel.relationship_type, `connector:${connectorId}`]
    );
    if ((inserted.rowCount ?? 0) > 0) {
      summary.relationships_created++;
      headroom--;
    } else {
      summary.relationships_existing++;
    }
  }
}

async function persistPlan(
  orgId: string,
  connectorId: string,
  plan: ConnectorSyncPlan,
  fullSync: boolean
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    connector_id: connectorId,
    sync_mode: fullSync ? "full" : "delta",
    detail_created: 0,
    detail_existing: 0,
    detail_cap_exceeded: 0,
    imported: 0,
    import_duplicate: 0,
    import_invalid: 0,
    import_cap_exceeded: 0,
    already_synced: 0,
    relationships_created: 0,
    relationships_existing: 0,
    relationships_unresolved: 0,
    relationships_cap_skipped: 0,
    relationships_self_dropped: 0,
    truncated: plan.truncated,
    observed: 0,
    drift_stale: 0,
    drift_reappeared: 0
  };

  for (const input of plan.detailInputs) {
    const result = await createDetailAsset(orgId, input);
    if ("row" in result) {
      summary.detail_created++;
    } else if (result.error === "cap_exceeded") {
      summary.detail_cap_exceeded++;
    } else {
      // name/external_ref conflict = this device is already in the registry (re-sync).
      summary.detail_existing++;
    }
  }

  for (const [entityType, rows] of Object.entries(plan.importGroups) as Array<[ImportEntityType, ImportRow[]]>) {
    // Re-sync pre-pass: rows whose external_ref is already in the org were
    // ingested by an earlier sync — skip them before name-dedup planning.
    const refs = rows.map((r) => r.external_ref).filter((r): r is string => typeof r === "string");
    const synced = await existingExternalRefs(entityType, orgId, refs);
    const fresh = rows.filter((r) => !(typeof r.external_ref === "string" && synced.has(r.external_ref)));
    summary.already_synced += rows.length - fresh.length;
    if (fresh.length === 0) continue;

    const keys = await existingKeys(entityType, orgId);
    const headroom = await capHeadroom(entityType, orgId);
    const imported = planImport({ entityType, rows: fresh, existingKeys: keys, capHeadroom: headroom });

    for (const row of imported.rows) {
      if (row.status === "ok" && row.normalized) {
        if (await insertImportRow(orgId, row.normalized, "connector")) summary.imported++;
        else summary.import_duplicate++;
      } else if (row.status === "invalid") {
        summary.import_invalid++;
      } else if (row.status === "cap_exceeded") {
        summary.import_cap_exceeded++;
      } else {
        summary.import_duplicate++;
      }
    }
  }

  await persistRelationships(orgId, connectorId, plan, summary);

  // E2.P2 (ERIP-AD-8/11): record discovery facts, then reconcile drift. On a
  // full sync the reappearance count is read BEFORE the upsert clears stale,
  // and drift-stale is marked AFTER (touched rows carry this tx's timestamp).
  const observations = planObservations(plan);
  const reconcile: ReconcileSummary = { observed: 0, drift_stale: 0, drift_reappeared: 0 };
  if (fullSync) {
    reconcile.drift_reappeared = await countReappearing(
      orgId,
      connectorId,
      observations.map((o) => o.external_ref)
    );
  }
  await upsertObservations(orgId, connectorId, observations, fullSync, reconcile);
  if (fullSync) {
    reconcile.drift_stale = await markDriftStale(orgId, connectorId);
  }
  summary.observed = reconcile.observed;
  summary.drift_stale = reconcile.drift_stale;
  summary.drift_reappeared = reconcile.drift_reappeared;

  return summary;
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
    // Best-effort status surface; the failure state on the job row is the truth.
    const connectorId = typeof job.payload?.connector_id === "string" ? job.payload.connector_id : null;
    if (connectorId) {
      // E2.P1 (ERIP-AD-9): a terminal run failure bumps the failure streak and,
      // when the connector is on a schedule, pushes next_sync_at out by the
      // pure backoff policy. Job-level retries (status 'queued') are NOT a run
      // failure yet — they stay on the jobs machinery's own backoff.
      const terminal = decision.status !== "queued";
      const row = await pg.query<{ sync_interval_minutes: number | null; consecutive_failures: number }>(
        `SELECT sync_interval_minutes, consecutive_failures FROM enterprise_connectors
          WHERE organization_id = $1 AND connector_id = $2`,
        [job.organization_id, connectorId]
      );
      const sched = row.rows[0];
      if (terminal && sched) {
        const failures = sched.consecutive_failures + 1;
        const backoffMin =
          sched.sync_interval_minutes !== null
            ? scheduleBackoffMinutes(sched.sync_interval_minutes, failures)
            : null;
        await pg.query(
          `UPDATE enterprise_connectors
              SET last_sync_at = now(), last_sync_status = 'failed',
                  consecutive_failures = $3,
                  next_sync_at = CASE WHEN $4::int IS NULL THEN next_sync_at
                                      ELSE now() + make_interval(mins => $4::int) END,
                  updated_at = now()
            WHERE organization_id = $1 AND connector_id = $2`,
          [job.organization_id, connectorId, failures, backoffMin]
        );
      } else if (sched) {
        await pg.query(
          `UPDATE enterprise_connectors
              SET last_sync_at = now(), last_sync_status = 'failed', updated_at = now()
            WHERE organization_id = $1 AND connector_id = $2`,
          [job.organization_id, connectorId]
        );
      }
    }
  });
}

/**
 * Process one already-claimed job to completion. Never throws — every outcome
 * is persisted to the row (the data-rights/reassessment discipline).
 */
export async function processClaimedJob(job: JobRow, deps: WorkerDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const orgId = job.organization_id;

  const connectorId = typeof job.payload?.connector_id === "string" ? job.payload.connector_id : null;
  const adapter: ConnectorAdapter | undefined = connectorId ? getConnector(connectorId) : undefined;
  if (!connectorId || !adapter) {
    await recordFailure(job, new NonRetryableJobError("connector_sync job payload has no known connector_id"), now());
    logger.error(
      { event: "connector_sync_job_invalid_payload", job_id: job.id, org_id: orgId, connectorId },
      "connector-sync job failed: unknown connector"
    );
    return;
  }

  let summary: SyncSummary;
  try {
    // 1. Load + decrypt config (short tenant read — no tx held across fetch).
    const row: ConnectorRow | null = await withTenant(orgId, () => getConnectorRow(orgId, connectorId));
    if (!row) throw new NonRetryableJobError(`connector ${connectorId} is not configured for this organization`);
    if (!row.enabled) throw new NonRetryableJobError(`connector ${connectorId} is disabled`);
    const config = decryptConnectorConfig(row);
    if (!config) throw new NonRetryableJobError(`connector ${connectorId} config could not be decrypted`);

    // 2. Fetch + normalize — network I/O outside any transaction.
    //    E2.P2 (ERIP-AD-10): adapters that implement fetchDelta run incrementally
    //    once a cursor exists; the seed run (cursor null) fetches everything and
    //    counts as a FULL sync (it can reconcile drift). Adapters without the
    //    capability always full-sync via fetch().
    const http = deps.http ?? buildConnectorHttpClient();
    const storedCursor = row.sync_cursor;
    let inventory: NormalizedInventory;
    let nextCursor: ConnectorCursor | null = null;
    let fullSync: boolean;
    if (adapter.fetchDelta) {
      const delta = await adapter.fetchDelta(config, http, storedCursor);
      inventory = adapter.normalize(delta.raw);
      nextCursor = delta.next_cursor;
      fullSync = storedCursor === null;
    } else {
      const raw = await adapter.fetch(config, http);
      inventory = adapter.normalize(raw);
      fullSync = true;
    }

    // 3+4. Plan and persist in ONE tenant tx; completion commits with the work.
    summary = await withTenant(orgId, async () => {
      const plan = planConnectorSync(adapter, inventory, config);
      const persisted = await persistPlan(orgId, connectorId, plan, fullSync);

      await pg.query(
        `UPDATE enterprise_connectors
            SET last_sync_at = now(), last_sync_status = 'succeeded',
                last_sync_summary = $3::jsonb,
                consecutive_failures = 0,
                sync_cursor = COALESCE($4::jsonb, sync_cursor),
                updated_at = now()
          WHERE organization_id = $1 AND connector_id = $2`,
        [orgId, connectorId, JSON.stringify(persisted), nextCursor === null ? null : JSON.stringify(nextCursor)]
      );
      await pg.query(
        `UPDATE jobs
            SET status = 'succeeded', result = $2::jsonb, error = NULL,
                locked_by = NULL, locked_at = NULL,
                completed_at = now(), updated_at = now()
          WHERE id = $1`,
        [job.id, JSON.stringify(persisted)]
      );
      return persisted;
    });
  } catch (err) {
    await recordFailure(job, err, now());
    logger.error(
      { event: "connector_sync_job_failed", job_id: job.id, org_id: orgId, connectorId, err },
      "connector-sync job failed; failure state recorded"
    );
    return;
  }

  // ---- AFTER COMMIT: audit mirror (+ loud truncation note, never silent). ----
  if (summary.truncated > 0 || summary.relationships_unresolved > 0 || summary.relationships_cap_skipped > 0) {
    logger.warn(
      {
        event: "connector_sync_partial_coverage",
        job_id: job.id,
        org_id: orgId,
        connectorId,
        truncated: summary.truncated,
        relationships_unresolved: summary.relationships_unresolved,
        relationships_cap_skipped: summary.relationships_cap_skipped
      },
      "connector-sync: inventory truncated and/or some relationships not persisted (unresolved endpoints or edge cap)"
    );
  }

  writeAuditEvent({
    organizationId: orgId,
    eventType: "connector.synced",
    resourceType: "enterprise_connector",
    resourceId: null,
    payload: { job_id: job.id, ...summary }
  });

  logger.info(
    { event: "connector_sync_job_complete", job_id: job.id, org_id: orgId, connectorId, ...summary },
    "connector-sync job complete"
  );
}

// ---------------------------------------------------------------------------
// E2.P1 (ERIP-AD-9): scheduled synchronization — the due-connector scan
// ---------------------------------------------------------------------------

/** Bounded per-tick fan-out — a huge estate drains over successive ticks. */
export const MAX_SCHEDULED_ENQUEUES_PER_TICK = 100;

interface DueConnectorRow {
  organization_id: string;
  connector_id: string;
  sync_interval_minutes: number;
}

/**
 * Enqueue one deduped `connector_sync` job per due (org, connector) and
 * advance its next_sync_at by the configured interval. The scan is cross-org
 * (elevated channel — the brief-scheduler fan-out precedent); each enqueue +
 * schedule advance runs inside that org's tenant tx. next_sync_at advances
 * even when the enqueue dedups against a pending run, so a stuck job cannot
 * hot-loop the scheduler. Returns the number of jobs actually enqueued.
 */
export async function runScheduleScan(): Promise<number> {
  const due = await pgElevated.query<DueConnectorRow>(
    `SELECT organization_id, connector_id, sync_interval_minutes
       FROM enterprise_connectors
      WHERE enabled
        AND sync_interval_minutes IS NOT NULL
        AND (next_sync_at IS NULL OR next_sync_at <= now())
      ORDER BY next_sync_at ASC NULLS FIRST
      LIMIT ${MAX_SCHEDULED_ENQUEUES_PER_TICK}`
  );

  let enqueued = 0;
  for (const row of due.rows) {
    const payload = JSON.stringify({ connector_id: row.connector_id });
    const n = await withTenant(row.organization_id, async () => {
      // The route's enqueue-dedup shape verbatim: one pending run per (org, connector).
      const inserted = await pg.query<{ id: string }>(
        `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
         SELECT $1::uuid, NULL, $2, $3::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM jobs j
             WHERE j.organization_id = $1::uuid
               AND j.job_type = $2
               AND j.status IN ('queued', 'processing')
               AND j.payload = $3::jsonb
          )
         RETURNING id`,
        [row.organization_id, CONNECTOR_SYNC_JOB_TYPE, payload]
      );
      await pg.query(
        `UPDATE enterprise_connectors
            SET next_sync_at = now() + make_interval(mins => $3::int), updated_at = now()
          WHERE organization_id = $1 AND connector_id = $2`,
        [row.organization_id, row.connector_id, row.sync_interval_minutes]
      );
      return inserted.rowCount ?? 0;
    });
    enqueued += n;
  }

  if (due.rows.length > 0) {
    logger.info(
      { event: "connector_sync_schedule_scan", due: due.rows.length, enqueued },
      "connector-sync scheduler: due connectors scanned"
    );
  }
  return enqueued;
}

/**
 * Drain the queue: claim + process until none claimable (or shutdown).
 * Double-fenced idle-skip: connectors are an ECL surface AND create registry
 * assets, so BOTH flags must be on before a claim runs. The scheduled-sync
 * scan is additionally fenced on its own flag (triple fence, ERIP-AD-9) —
 * with it off, this tick is byte-identical to the pre-E2.P1 behavior.
 */
export async function runOneTick(deps: WorkerDeps = {}): Promise<number> {
  if (!enterpriseContextEnabled() || !assetRegistryEnabled()) return 0;

  if (connectorScheduledSyncEnabled()) {
    await runScheduleScan();
  }

  const workerId = deps.workerId ?? `connector-sync-${process.pid}`;
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
 * queue. Always registered; each tick self-gates on BOTH flags inside
 * runOneTick (zero DB access while off) — a flag flip takes effect on the next
 * tick with no redeploy.
 */
export function startConnectorSyncWorker(): void {
  schedule("* * * * *", () => {
    if (isTicking) {
      logger.warn(
        { event: "connector_sync_tick_overlap_skipped" },
        "connector-sync worker: previous tick still running — skipping"
      );
      return;
    }
    isTicking = true;
    void runOneTick()
      .catch((err) => {
        logger.error({ event: "connector_sync_tick_error", err }, "connector-sync worker tick failed");
      })
      .finally(() => {
        isTicking = false;
      });
  });
  logger.info(
    { event: "connector_sync_worker_registered", schedule: "* * * * * (every minute)" },
    "Connector sync worker registered (gated by SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED + SECURELOGIC_ASSET_REGISTRY_ENABLED)"
  );
}
