/**
 * Cluster-key backfill — Priority 4 / Phase 4C / slice C2.
 *
 * Populates cyber_signals.cluster_key (added by 20260709) for existing rows,
 * using the SAME C1 function clusterKey() — no SQL duplicate of the logic, so
 * the seed migration carries no clustering rules. C2 deliberately does NOT stamp
 * cluster_key at the 13 INSERT sites, so this is how the column is populated
 * (operator-run; later slices may wire it into a cadence).
 *
 * GLOBAL: cyber_signals rows are org-agnostic; no organization_id is read or
 * written and no per-org scoping is involved.
 *
 * Terminating + effect-idempotent: a cursor over `id` advances past every
 * already-scanned NULL row (including degenerate rows whose key is null and stay
 * NULL = singleton), so a run processes each currently-NULL row exactly once.
 * Re-running reprocesses only rows still NULL (degenerate / newly inserted) — a
 * bounded, shrinking-then-stable set; the final DB state is identical.
 */

import { clusterKey } from "./clusterKey.js";

/** Minimal client surface so the backfill is injectable + unit-testable. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface ClusterKeyBackfillResult {
  /** Rows examined (cluster_key was NULL when read). */
  readonly scanned: number;
  /** Rows stamped with a non-null cluster_key. */
  readonly stamped: number;
}

interface Row {
  id: string;
  affected_cve: string | null;
  affected_vendor: string | null;
  signal_type: string;
  ingestion_timestamp: string | Date;
}

const UUID_FLOOR = "00000000-0000-0000-0000-000000000000";

/**
 * Backfill cluster_key for all rows where it is NULL. Returns {scanned, stamped}.
 * Stamps only non-null keys; degenerate (null-key) rows are left NULL (singleton)
 * and skipped by the cursor so the run terminates.
 */
export async function backfillClusterKeys(
  db: Queryable,
  batchSize = 1000
): Promise<ClusterKeyBackfillResult> {
  let cursor = UUID_FLOOR;
  let scanned = 0;
  let stamped = 0;

  for (;;) {
    const { rows } = await db.query<Row>(
      `SELECT id, affected_cve, affected_vendor, signal_type, ingestion_timestamp
         FROM cyber_signals
        WHERE cluster_key IS NULL
          AND id > $1
        ORDER BY id
        LIMIT $2`,
      [cursor, batchSize]
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const key = clusterKey({
        affected_cve: row.affected_cve,
        affected_vendor: row.affected_vendor,
        signal_type: row.signal_type,
        ingestion_timestamp: row.ingestion_timestamp
      });
      if (key !== null) {
        await db.query(
          `UPDATE cyber_signals SET cluster_key = $1 WHERE id = $2 AND cluster_key IS NULL`,
          [key, row.id]
        );
        stamped += 1;
      }
    }

    cursor = rows[rows.length - 1]!.id; // advance past this batch (incl. degenerate NULLs)
  }

  return { scanned, stamped };
}
