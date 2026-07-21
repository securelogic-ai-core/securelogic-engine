/**
 * connectorDeadLetterStore.ts — ERIP Epic 2 (E2b): tenant-scoped persistence
 * for connector_dead_letters (20260821). Capture (from the sync/writeback
 * workers, inside their tenant tx), operator list, and re-drive.
 *
 * Re-drive re-enqueues the failed operation and marks the event 'redriven':
 *   - connector_sync      → INSERT a fresh connector_sync job (deduped against
 *                           any pending run), reusing the enqueue shape.
 *   - connector_writeback → flip the referenced intent back to 'pending'
 *                           (attempts 0, backoff cleared) so the writeback
 *                           worker retries it.
 *
 * All queries run on the tenant `pg` proxy with explicit org predicates. No
 * secrets live in this table (creds stay in enterprise_connectors).
 */

import { pg } from "../infra/postgres.js";
import { CONNECTOR_SYNC_JOB_TYPE } from "./connectorSyncCore.js";

export type DeadLetterSource = "connector_sync" | "connector_writeback";

export interface DeadLetterRow {
  id: string;
  organization_id: string;
  source: DeadLetterSource;
  connector_id: string;
  ref_id: string | null;
  external_ref: string | null;
  field: string | null;
  attempts: number;
  error: string | null;
  payload: Record<string, unknown> | null;
  status: "open" | "redriven" | "ignored";
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
}

const ROW_COLS =
  "id, organization_id, source, connector_id, ref_id, external_ref, field, attempts, error, payload, status, created_at, updated_at, resolved_at, resolved_by_user_id";

export interface DeadLetterCapture {
  source: DeadLetterSource;
  connectorId: string;
  refId: string | null;
  externalRef?: string | null;
  field?: string | null;
  attempts: number;
  error: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Record a terminal connector failure as a dead-letter. Called from within the
 * worker's existing tenant transaction — additive, best-effort context for
 * operator recovery (the upstream failure state remains the source of truth).
 */
export async function captureDeadLetter(orgId: string, c: DeadLetterCapture): Promise<void> {
  await pg.query(
    `INSERT INTO connector_dead_letters
       (organization_id, source, connector_id, ref_id, external_ref, field, attempts, error, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      orgId,
      c.source,
      c.connectorId,
      c.refId,
      c.externalRef ?? null,
      c.field ?? null,
      c.attempts,
      c.error.slice(0, 2000),
      c.payload === undefined || c.payload === null ? null : JSON.stringify(c.payload)
    ]
  );
}

export interface DeadLetterFilter {
  status?: "open" | "redriven" | "ignored";
  connectorId?: string;
}

/** List an org's dead-letters (newest first, bounded). */
export async function listDeadLetters(orgId: string, filter: DeadLetterFilter = {}, limit = 200): Promise<DeadLetterRow[]> {
  const clauses = ["organization_id = $1"];
  const params: unknown[] = [orgId];
  if (filter.status) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filter.connectorId) {
    params.push(filter.connectorId);
    clauses.push(`connector_id = $${params.length}`);
  }
  params.push(limit);
  const r = await pg.query(
    `SELECT ${ROW_COLS} FROM connector_dead_letters
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return r.rows as DeadLetterRow[];
}

/** Open-dead-letter count per connector (health surface / triage). */
export async function openDeadLetterCounts(orgId: string): Promise<Record<string, number>> {
  const r = await pg.query<{ connector_id: string; n: string }>(
    `SELECT connector_id, COUNT(*)::text AS n FROM connector_dead_letters
      WHERE organization_id = $1 AND status = 'open'
      GROUP BY connector_id`,
    [orgId]
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.connector_id] = Number(row.n);
  return out;
}

async function getOpenDeadLetter(orgId: string, id: string): Promise<DeadLetterRow | null> {
  const r = await pg.query(
    `SELECT ${ROW_COLS} FROM connector_dead_letters
      WHERE organization_id = $1 AND id = $2 AND status = 'open' LIMIT 1`,
    [orgId, id]
  );
  return (r.rows[0] as DeadLetterRow | undefined) ?? null;
}

export type RedriveResult =
  | { ok: true; action: "sync_enqueued" | "writeback_requeued"; detail: Record<string, unknown> }
  | { ok: false; error: "not_found" | "already_resolved" | "unredrivable" };

/**
 * Re-drive an OPEN dead-letter: re-enqueue the failed operation and mark the
 * event 'redriven'. Idempotent against concurrent resolution (the status guard
 * in the UPDATE). Runs inside asTenant/withTenant.
 */
export async function redriveDeadLetter(orgId: string, id: string, userId: string | null): Promise<RedriveResult> {
  const dl = await getOpenDeadLetter(orgId, id);
  if (!dl) return { ok: false, error: "not_found" };

  let action: "sync_enqueued" | "writeback_requeued";
  let detail: Record<string, unknown>;

  if (dl.source === "connector_sync") {
    const payload = JSON.stringify({ connector_id: dl.connector_id });
    const enq = await pg.query<{ id: string }>(
      `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
       SELECT $1::uuid, $4, $2, $3::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM jobs j
           WHERE j.organization_id = $1::uuid AND j.job_type = $2
             AND j.status IN ('queued', 'processing') AND j.payload = $3::jsonb
        )
       RETURNING id`,
      [orgId, CONNECTOR_SYNC_JOB_TYPE, payload, userId]
    );
    action = "sync_enqueued";
    detail = { job_id: enq.rows[0]?.id ?? null, deduped: (enq.rowCount ?? 0) === 0 };
  } else {
    // connector_writeback: flip the referenced intent back to pending.
    if (!dl.ref_id) return { ok: false, error: "unredrivable" };
    const upd = await pg.query(
      `UPDATE connector_writeback_intents
          SET status = 'pending', attempts = 0, next_attempt_at = NULL, detail = NULL, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [orgId, dl.ref_id]
    );
    action = "writeback_requeued";
    detail = { intent_id: dl.ref_id, requeued: (upd.rowCount ?? 0) > 0 };
  }

  const resolved = await pg.query(
    `UPDATE connector_dead_letters
        SET status = 'redriven', resolved_at = now(), resolved_by_user_id = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2 AND status = 'open'
      RETURNING id`,
    [orgId, id, userId]
  );
  if ((resolved.rowCount ?? 0) === 0) return { ok: false, error: "already_resolved" };
  return { ok: true, action, detail };
}

/** Dismiss an open dead-letter without re-driving. */
export async function ignoreDeadLetter(orgId: string, id: string, userId: string | null): Promise<boolean> {
  const r = await pg.query(
    `UPDATE connector_dead_letters
        SET status = 'ignored', resolved_at = now(), resolved_by_user_id = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2 AND status = 'open'
      RETURNING id`,
    [orgId, id, userId]
  );
  return (r.rowCount ?? 0) > 0;
}
