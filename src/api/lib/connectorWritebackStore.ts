/**
 * connectorWritebackStore.ts — ERIP Epic 2 (E2a): tenant-scoped persistence for
 * connector_writeback_intents (20260820). Enqueue (route), due-scan (worker,
 * elevated), and per-intent outcome writes (worker, tenant). No secrets live in
 * this table, so there is no redaction concern — but detail strings are bounded
 * and never carry credentials by construction (adapters surface status only).
 *
 * Tenant queries run on the `pg` proxy under withTenant/asTenant with explicit
 * org predicates; the cross-org due-scan uses the elevated channel (the
 * connector-scheduler precedent).
 */

import { pg, pgElevated } from "../infra/postgres.js";

export interface WritebackIntentRow {
  id: string;
  organization_id: string;
  connector_id: string;
  external_ref: string;
  field: string;
  desired_value: string;
  status: "pending" | "applied" | "conflict" | "failed";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_pushed_value: string | null;
  external_prev_value: string | null;
  detail: string | null;
  source: "operator" | "engine";
  requested_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

const ROW_COLS =
  "id, organization_id, connector_id, external_ref, field, desired_value, status, attempts, max_attempts, next_attempt_at, last_pushed_value, external_prev_value, detail, source, requested_by_user_id, created_at, updated_at, applied_at";

export interface WritebackIntentInput {
  external_ref: string;
  field: string;
  desired_value: string;
}

/**
 * Upsert one LIVE intent per (org, connector, external_ref, field). A repeat
 * enqueue supersedes the prior desired value IN PLACE and resets the concurrency
 * state to pending (attempts 0, backoff cleared) — but PRESERVES
 * last_pushed_value so optimistic concurrency still detects external drift
 * across re-enqueues. Returns the number of rows written.
 */
export async function enqueueWritebackIntents(
  orgId: string,
  connectorId: string,
  intents: readonly WritebackIntentInput[],
  source: "operator" | "engine",
  userId: string | null
): Promise<number> {
  let written = 0;
  for (const it of intents) {
    const r = await pg.query(
      `INSERT INTO connector_writeback_intents
         (organization_id, connector_id, external_ref, field, desired_value, source, requested_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, connector_id, external_ref, field)
       DO UPDATE SET desired_value = EXCLUDED.desired_value,
                     status = 'pending',
                     attempts = 0,
                     next_attempt_at = NULL,
                     detail = NULL,
                     source = EXCLUDED.source,
                     requested_by_user_id = EXCLUDED.requested_by_user_id,
                     updated_at = now()
       RETURNING id`,
      [orgId, connectorId, it.external_ref, it.field, it.desired_value, source, userId]
    );
    written += r.rowCount ?? 0;
  }
  return written;
}

/** Route-facing list for a connector (most recent first, bounded). */
export async function listWritebackIntents(
  orgId: string,
  connectorId: string,
  limit = 200
): Promise<WritebackIntentRow[]> {
  const r = await pg.query(
    `SELECT ${ROW_COLS} FROM connector_writeback_intents
      WHERE organization_id = $1 AND connector_id = $2
      ORDER BY updated_at DESC
      LIMIT $3`,
    [orgId, connectorId, limit]
  );
  return r.rows as WritebackIntentRow[];
}

/** Per-status counts for a connector (health surface / route summary). */
export async function writebackStatusCounts(
  orgId: string,
  connectorId: string
): Promise<Record<string, number>> {
  const r = await pg.query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n FROM connector_writeback_intents
      WHERE organization_id = $1 AND connector_id = $2
      GROUP BY status`,
    [orgId, connectorId]
  );
  const out: Record<string, number> = { pending: 0, applied: 0, conflict: 0, failed: 0 };
  for (const row of r.rows) out[row.status] = Number(row.n);
  return out;
}

export interface DueWritebackConnector {
  organization_id: string;
  connector_id: string;
}

/**
 * Cross-org scan (elevated) for (org, connector) pairs that have at least one
 * DUE pending intent AND whose connector is ENABLED. Bounded fan-out; the
 * worker drains each pair's intents under its own tenant transaction.
 */
export async function scanDueWritebackConnectors(limit: number): Promise<DueWritebackConnector[]> {
  const r = await pgElevated.query<DueWritebackConnector>(
    `SELECT DISTINCT w.organization_id, w.connector_id
       FROM connector_writeback_intents w
       JOIN enterprise_connectors c
         ON c.organization_id = w.organization_id AND c.connector_id = w.connector_id
      WHERE w.status = 'pending'
        AND (w.next_attempt_at IS NULL OR w.next_attempt_at <= now())
        AND c.enabled
      ORDER BY w.organization_id, w.connector_id
      LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/** Read due pending intents for one (org, connector) (tenant). Bounded. */
export async function readDueIntents(
  orgId: string,
  connectorId: string,
  limit: number
): Promise<WritebackIntentRow[]> {
  const r = await pg.query(
    `SELECT ${ROW_COLS} FROM connector_writeback_intents
      WHERE organization_id = $1 AND connector_id = $2
        AND status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at
      LIMIT $3`,
    [orgId, connectorId, limit]
  );
  return r.rows as WritebackIntentRow[];
}

/**
 * Terminal success (apply OR noop-adopt): record the value we now own and the
 * external value we observed/overwrote. attempts bumped for auditability.
 */
export async function recordApplied(
  orgId: string,
  id: string,
  lastPushed: string,
  externalPrev: string | null
): Promise<void> {
  await pg.query(
    `UPDATE connector_writeback_intents
        SET status = 'applied', last_pushed_value = $3, external_prev_value = $4,
            attempts = attempts + 1, next_attempt_at = NULL, detail = NULL,
            applied_at = now(), updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, id, lastPushed, externalPrev]
  );
}

/** Terminal conflict: external drifted from our last push — HELD, not overwritten. */
export async function recordConflict(orgId: string, id: string, externalCurrent: string | null): Promise<void> {
  await pg.query(
    `UPDATE connector_writeback_intents
        SET status = 'conflict', external_prev_value = $3,
            detail = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, id, externalCurrent, `external value drifted since last push: ${externalCurrent === null ? "<absent>" : externalCurrent}`.slice(0, 500)]
  );
}

/** Transient failure: stay pending, bump attempts, back off. */
export async function recordTransientFailure(
  orgId: string,
  id: string,
  attempts: number,
  nextAttemptAt: Date,
  detail: string
): Promise<void> {
  await pg.query(
    `UPDATE connector_writeback_intents
        SET attempts = $3, next_attempt_at = $4, detail = $5, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, id, attempts, nextAttemptAt, detail.slice(0, 500)]
  );
}

/** Terminal failure: attempts exhausted (or non-retryable). */
export async function recordTerminalFailure(
  orgId: string,
  id: string,
  attempts: number,
  detail: string
): Promise<void> {
  await pg.query(
    `UPDATE connector_writeback_intents
        SET status = 'failed', attempts = $3, next_attempt_at = NULL,
            detail = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, id, attempts, detail.slice(0, 500)]
  );
}
