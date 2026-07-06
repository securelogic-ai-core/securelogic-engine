/**
 * connectorScheduleCore.ts — ERIP Epic 2 (E2.P1): DB-free scheduling policy
 * for connector synchronization (design: docs/architecture/erip/
 * E2-DISCOVERY-CONNECTORS-MEMO.md, ERIP-AD-9).
 *
 * Pure module (no infra/postgres import — the dataRightsWorkerPolicy split):
 * the interval validation the PUT route applies, and the backoff the worker
 * applies after consecutive failures. The DB-touching scheduler scan lives in
 * connectorSyncWorker.ts.
 */

/** Minimum allowed cadence. MUST mirror the 20260811 migration CHECK
 *  (`sync_interval_minutes >= 15`) — unit lockstep-asserted. */
export const SYNC_INTERVAL_MIN_MINUTES = 15;

/** Backoff never pushes a schedule out more than a day. */
export const SYNC_BACKOFF_CAP_MINUTES = 24 * 60;

/** Exponent cap so 2**n stays sane for long failure streaks. */
const MAX_BACKOFF_DOUBLINGS = 5;

/**
 * Minutes until the next scheduled attempt after `consecutiveFailures`
 * failed runs: interval, 2×, 4×, … capped at SYNC_BACKOFF_CAP_MINUTES.
 * failures = 0 → the plain interval.
 */
export function scheduleBackoffMinutes(
  intervalMinutes: number,
  consecutiveFailures: number
): number {
  const doublings = Math.min(Math.max(consecutiveFailures, 0), MAX_BACKOFF_DOUBLINGS);
  return Math.min(intervalMinutes * 2 ** doublings, SYNC_BACKOFF_CAP_MINUTES);
}

export type SyncIntervalParse =
  | { value: number | null }
  | { error: "sync_interval_invalid"; detail: string };

/**
 * Validate a PUT body's `sync_interval_minutes`: null clears the schedule
 * (manual-only); an integer >= SYNC_INTERVAL_MIN_MINUTES sets it. Anything
 * else — fractions, strings, negatives, sub-minimum — is rejected.
 */
export function parseSyncIntervalMinutes(v: unknown): SyncIntervalParse {
  if (v === null) return { value: null };
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return { error: "sync_interval_invalid", detail: "sync_interval_minutes must be an integer or null" };
  }
  if (v < SYNC_INTERVAL_MIN_MINUTES) {
    return {
      error: "sync_interval_invalid",
      detail: `sync_interval_minutes must be >= ${SYNC_INTERVAL_MIN_MINUTES}`
    };
  }
  return { value: v };
}
