/**
 * connectorHealthStore.ts — ERIP Epic 2 (E2c): gather the raw health signals for
 * every CONFIGURED connector of an org (tenant reads, explicit org predicates).
 * Pure assessment happens in connectorHealthCore; this module only reads.
 *
 * Signals are aggregated from the tables the connector pipelines already write:
 * enterprise_connectors (sync outcome + schedule + failure streak),
 * connector_asset_observations (drift/stale), connector_writeback_intents
 * (writeback backlog by status), connector_dead_letters (open recovery items).
 */

import { pg } from "../infra/postgres.js";
import { listConnectorRows } from "./connectorConfigStore.js";
import { openDeadLetterCounts } from "./connectorDeadLetterStore.js";

export interface ConnectorHealthRaw {
  connector_id: string;
  enabled: boolean;
  last_sync_status: string | null;
  last_sync_at: string | null;
  consecutive_failures: number;
  sync_interval_minutes: number | null;
  next_sync_at: string | null;
  stale_observations: number;
  writeback_pending: number;
  writeback_conflict: number;
  writeback_failed: number;
  open_dead_letters: number;
}

/** Per-configured-connector raw signals, keyed by connector_id. */
export async function gatherConnectorHealth(orgId: string): Promise<Map<string, ConnectorHealthRaw>> {
  const [rows, stale, writeback, deadLetters] = await Promise.all([
    listConnectorRows(orgId),
    pg.query<{ connector_id: string; n: string }>(
      `SELECT connector_id, COUNT(*)::text AS n FROM connector_asset_observations
        WHERE organization_id = $1 AND stale GROUP BY connector_id`,
      [orgId]
    ),
    pg.query<{ connector_id: string; status: string; n: string }>(
      `SELECT connector_id, status, COUNT(*)::text AS n FROM connector_writeback_intents
        WHERE organization_id = $1 GROUP BY connector_id, status`,
      [orgId]
    ),
    openDeadLetterCounts(orgId)
  ]);

  const staleByConn = new Map<string, number>();
  for (const r of stale.rows) staleByConn.set(r.connector_id, Number(r.n));

  const wbByConn = new Map<string, { pending: number; conflict: number; failed: number }>();
  for (const r of writeback.rows) {
    const e = wbByConn.get(r.connector_id) ?? { pending: 0, conflict: 0, failed: 0 };
    if (r.status === "pending") e.pending = Number(r.n);
    else if (r.status === "conflict") e.conflict = Number(r.n);
    else if (r.status === "failed") e.failed = Number(r.n);
    wbByConn.set(r.connector_id, e);
  }

  const out = new Map<string, ConnectorHealthRaw>();
  for (const row of rows) {
    const wb = wbByConn.get(row.connector_id) ?? { pending: 0, conflict: 0, failed: 0 };
    out.set(row.connector_id, {
      connector_id: row.connector_id,
      enabled: row.enabled,
      last_sync_status: row.last_sync_status,
      last_sync_at: row.last_sync_at,
      consecutive_failures: row.consecutive_failures,
      sync_interval_minutes: row.sync_interval_minutes,
      next_sync_at: row.next_sync_at,
      stale_observations: staleByConn.get(row.connector_id) ?? 0,
      writeback_pending: wb.pending,
      writeback_conflict: wb.conflict,
      writeback_failed: wb.failed,
      open_dead_letters: deadLetters[row.connector_id] ?? 0
    });
  }
  return out;
}
