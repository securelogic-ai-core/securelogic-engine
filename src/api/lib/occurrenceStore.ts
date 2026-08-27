/**
 * occurrenceStore.ts — the ONE convergent write for a vulnerability occurrence.
 *
 * Extracted from the inline upsert in findingAssetOccurrences.ts (SL-OCC-1)
 * the moment a SECOND writer appeared (the scanner-ingestion intake,
 * SL-OCC-3). Two hand-maintained copies of "record that this asset is exposed
 * to this finding" is exactly how the vendor<-finding linkage hole was dug —
 * one writer's semantics drift a field at a time until the readers disagree —
 * so the SQL moved here before the second copy could exist. The route and the
 * intake both call this; the PURE presence-transition rules stay where they
 * were, in occurrenceLifecycle.observe().
 *
 * Semantics (unchanged from the route, byte-for-byte in effect):
 *   - identity is (organization_id, finding_id, asset_id); recording the same
 *     exposure twice converges on one row;
 *   - an existing row takes observe(): last_seen_at moves forward, an ABSENT
 *     exposure reappears (reappeared_count increments) — and the FINDING is
 *     never touched: reappearance is an occurrence fact for a human to act on,
 *     never an auto-reopen (SL-OCC-2 ruling; operational_status is derived
 *     from decision_state and this module has no business near either);
 *   - source / source_occurrence_id are COALESCE-kept: a later writer that
 *     does not know the source must not blank the one that did.
 *
 * AUDITING IS THE CALLER'S. The route writes one audit event per occurrence,
 * which is right for a human act. The scan intake writes one SUMMARY event per
 * run, which is right for two thousand of them. The store returns the facts
 * (created / reappeared) and takes no position.
 *
 * Callers must run inside a tenant scope; every statement is org-scoped anyway
 * (self-consistent, not self-authorising — the linkage rule).
 */

import { observe, type OccurrenceState } from "./occurrenceLifecycle.js";

/** Minimal queryable so callers may supply their own transaction. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface RecordOccurrenceArgs {
  organizationId: string;
  findingId: string;
  assetId: string;
  source: string | null;
  sourceOccurrenceId: string | null;
  createdByUserId: string | null;
}

export interface RecordOccurrenceResult {
  occurrence: Record<string, unknown>;
  occurrenceId: string;
  created: boolean;
  reappeared: boolean;
}

export async function recordOccurrenceObservation(
  client: Queryable,
  args: RecordOccurrenceArgs
): Promise<RecordOccurrenceResult> {
  const { organizationId, findingId, assetId, source, sourceOccurrenceId } = args;

  const existing = await client.query<OccurrenceState & { id: string }>(
    `SELECT id, presence_status, first_seen_at, last_seen_at, absent_since,
            remediated_at, reappeared_count, last_reappeared_at
       FROM finding_asset_occurrences
      WHERE organization_id = $1 AND finding_id = $2 AND asset_id = $3`,
    [organizationId, findingId, assetId]
  );

  if (existing.rowCount && existing.rows[0]) {
    const state = existing.rows[0];
    const now = new Date().toISOString();
    const patch = observe(state, now);
    const updated = await client.query(
      `UPDATE finding_asset_occurrences
          -- GREATEST: the JS clock is millisecond-truncated while first_seen_at
          -- carries the DB's microseconds, so a same-instant re-observation can
          -- otherwise stamp last_seen 73us BEFORE first_seen and trip the
          -- occurrence_seen_window CHECK. Surfaced by machine-speed imports;
          -- latent in the manual route since SL-OCC-1.
          SET presence_status = $4,
              last_seen_at = GREATEST(first_seen_at, $5::timestamptz),
              absent_since = NULL,
              remediated_at = NULL,
              reappeared_count = COALESCE($6, reappeared_count),
              last_reappeared_at = COALESCE($7, last_reappeared_at),
              source = COALESCE($8, source),
              source_occurrence_id = COALESCE($9, source_occurrence_id),
              updated_at = NOW()
        WHERE organization_id = $1 AND finding_id = $2 AND asset_id = $3
        RETURNING *`,
      [
        organizationId,
        findingId,
        assetId,
        patch.presence_status,
        patch.last_seen_at,
        patch.reappeared_count ?? null,
        patch.last_reappeared_at ?? null,
        source,
        sourceOccurrenceId
      ]
    );
    return {
      occurrence: updated.rows[0]!,
      occurrenceId: state.id,
      created: false,
      reappeared: (patch.reappeared_count ?? 0) > state.reappeared_count
    };
  }

  const inserted = await client.query(
    `INSERT INTO finding_asset_occurrences
       (organization_id, finding_id, asset_id, source, source_occurrence_id,
        created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [organizationId, findingId, assetId, source, sourceOccurrenceId, args.createdByUserId]
  );
  return {
    occurrence: inserted.rows[0]!,
    occurrenceId: String((inserted.rows[0] as { id: string }).id),
    created: true,
    reappeared: false
  };
}
