/**
 * connectorObservationStore.ts — ERIP Epic 2 (E2.P2): tenant-scoped
 * persistence for connector_asset_observations (20260812), the discovery-fact
 * ledger (ERIP-AD-8). Runs on the tenant `pg` proxy (withTenant worker) with
 * explicit org predicates. Reconciliation/drift derive from these rows;
 * canonical stores are never mutated here (ERIP-AD-8/11).
 */

import { pg } from "../infra/postgres.js";
import type { ObservationInput } from "./connectorObservationCore.js";

export interface ReconcileSummary {
  observed: number;
  /** Refs newly marked stale by THIS full sync (were not reported this run). */
  drift_stale: number;
  /** Previously-stale refs reported again by THIS full sync. */
  drift_reappeared: number;
}

/**
 * Count how many of `refs` are currently marked stale for this connector.
 * Called BEFORE the upsert on a full sync — the upsert clears staleness, so
 * this is the only point the reappearance is observable. Chunked to keep the
 * ANY($n) array bounded.
 */
export async function countReappearing(
  orgId: string,
  connectorId: string,
  refs: readonly string[]
): Promise<number> {
  if (refs.length === 0) return 0;
  const unique = [...new Set(refs)];
  let total = 0;
  const CHUNK = 1000;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const r = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM connector_asset_observations
        WHERE organization_id = $1 AND connector_id = $2
          AND stale = TRUE AND external_ref = ANY($3::text[])`,
      [orgId, connectorId, slice]
    );
    total += r.rows[0]?.n ?? 0;
  }
  return total;
}

/**
 * Upsert one sync run's observations. `fullSync` stamps
 * last_full_sync_seen_at and clears the stale flag (a reported ref is not
 * stale). Delta syncs refresh last_seen_at/name/lane only — they never clear
 * staleness for refs they don't mention.
 */
export async function upsertObservations(
  orgId: string,
  connectorId: string,
  observations: readonly ObservationInput[],
  fullSync: boolean,
  summary: ReconcileSummary
): Promise<void> {
  for (const o of observations) {
    // E2.P4: owner_hint/metadata refresh ONLY when this run supplies them —
    // COALESCE keeps a prior discovery when the current source omits it.
    await pg.query(
      `INSERT INTO connector_asset_observations (
         organization_id, connector_id, external_ref, lane, entity_type, name,
         last_full_sync_seen_at, stale, owner_hint, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END, FALSE, $8, $9::jsonb)
       ON CONFLICT (organization_id, connector_id, external_ref)
       DO UPDATE SET
         last_seen_at = now(),
         lane = EXCLUDED.lane,
         entity_type = EXCLUDED.entity_type,
         name = EXCLUDED.name,
         last_full_sync_seen_at = CASE WHEN $7 THEN now()
                                       ELSE connector_asset_observations.last_full_sync_seen_at END,
         stale = CASE WHEN $7 THEN FALSE ELSE connector_asset_observations.stale END,
         owner_hint = COALESCE(EXCLUDED.owner_hint, connector_asset_observations.owner_hint),
         metadata = COALESCE(EXCLUDED.metadata, connector_asset_observations.metadata),
         updated_at = now()`,
      [
        orgId,
        connectorId,
        o.external_ref,
        o.lane,
        o.entity_type,
        o.name,
        fullSync,
        o.owner_hint,
        o.metadata === null ? null : JSON.stringify(o.metadata)
      ]
    );
    summary.observed++;
  }
}

/**
 * ERIP-AD-11: after a FULL sync, mark every not-yet-stale observation for this
 * connector that was NOT touched by this run as stale. Report-only — no
 * canonical row changes. Returns the count.
 *
 * MUST run inside the same transaction as upsertObservations: every touched
 * row's last_seen_at is set to now() (= transaction_timestamp(), constant for
 * the tx), so "not touched this run" is exactly last_seen_at <>
 * transaction_timestamp() — clock-independent, no JS timestamp threaded in.
 */
export async function markDriftStale(orgId: string, connectorId: string): Promise<number> {
  const r = await pg.query(
    `UPDATE connector_asset_observations
        SET stale = TRUE, updated_at = now()
      WHERE organization_id = $1
        AND connector_id = $2
        AND stale = FALSE
        AND last_seen_at <> transaction_timestamp()`,
    [orgId, connectorId]
  );
  return r.rowCount ?? 0;
}
