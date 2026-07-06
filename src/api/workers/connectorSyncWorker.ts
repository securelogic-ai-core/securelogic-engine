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
 * with an overlap guard (the reassessment precedent). Relationship persistence
 * is deferred (CSV parity) — counts are surfaced in the job result, not
 * silently dropped.
 */

import { schedule } from "node-cron";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enterpriseContextEnabled } from "../lib/enterpriseContextFeatureFlag.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import {
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  decideFailureState
} from "../lib/dataRightsWorkerPolicy.js";
import { getConnector } from "../lib/connectors/registry.js";
import type { ConnectorAdapter, HttpClient, NormalizedInventory } from "../lib/connectors/types.js";
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
import { createDetailAsset } from "../lib/assetDetailPersistence.js";
import { planImport, type ImportEntityType, type ImportRow } from "../lib/enterpriseContextImport.js";
import {
  existingKeys,
  capHeadroom,
  existingExternalRefs,
  insertImportRow
} from "../lib/enterpriseImportPersistence.js";

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
  detail_created: number;
  detail_existing: number;
  detail_cap_exceeded: number;
  imported: number;
  import_duplicate: number;
  import_invalid: number;
  import_cap_exceeded: number;
  already_synced: number;
  relationships_skipped: number;
  truncated: number;
}

async function persistPlan(orgId: string, connectorId: string, plan: ConnectorSyncPlan): Promise<SyncSummary> {
  const summary: SyncSummary = {
    connector_id: connectorId,
    detail_created: 0,
    detail_existing: 0,
    detail_cap_exceeded: 0,
    imported: 0,
    import_duplicate: 0,
    import_invalid: 0,
    import_cap_exceeded: 0,
    already_synced: 0,
    relationships_skipped: plan.relationshipsSkipped,
    truncated: plan.truncated
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
      await pg.query(
        `UPDATE enterprise_connectors
            SET last_sync_at = now(), last_sync_status = 'failed', updated_at = now()
          WHERE organization_id = $1 AND connector_id = $2`,
        [job.organization_id, connectorId]
      );
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
    const http = deps.http ?? buildConnectorHttpClient();
    const raw = await adapter.fetch(config, http);
    const inventory: NormalizedInventory = adapter.normalize(raw);

    // 3+4. Plan and persist in ONE tenant tx; completion commits with the work.
    summary = await withTenant(orgId, async () => {
      const plan = planConnectorSync(adapter, inventory, config);
      const persisted = await persistPlan(orgId, connectorId, plan);

      await pg.query(
        `UPDATE enterprise_connectors
            SET last_sync_at = now(), last_sync_status = 'succeeded',
                last_sync_summary = $3::jsonb, updated_at = now()
          WHERE organization_id = $1 AND connector_id = $2`,
        [orgId, connectorId, JSON.stringify(persisted)]
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
  if (summary.truncated > 0 || summary.relationships_skipped > 0) {
    logger.warn(
      {
        event: "connector_sync_partial_coverage",
        job_id: job.id,
        org_id: orgId,
        connectorId,
        truncated: summary.truncated,
        relationships_skipped: summary.relationships_skipped
      },
      "connector-sync: inventory truncated at cap and/or relationships deferred (CSV-import parity)"
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

/**
 * Drain the queue: claim + process until none claimable (or shutdown).
 * Double-fenced idle-skip: connectors are an ECL surface AND create registry
 * assets, so BOTH flags must be on before a claim runs.
 */
export async function runOneTick(deps: WorkerDeps = {}): Promise<number> {
  if (!enterpriseContextEnabled() || !assetRegistryEnabled()) return 0;

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
