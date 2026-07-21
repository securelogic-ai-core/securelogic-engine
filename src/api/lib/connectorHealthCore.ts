/**
 * connectorHealthCore.ts — ERIP Epic 2 (E2c): the PURE connector-health
 * assessment (ERIP-AD-14 health). No I/O. Blends every operational signal the
 * connector layer already records — sync outcome + failure streak, schedule
 * overdue-ness, drift (stale observations), writeback backlog (conflicts /
 * failures), and open dead-letters — into a single band + reason codes an
 * executive surface can render. Deterministic; `now` is injected.
 *
 * Band priority (worst wins): failing > degraded > pending_first_sync > healthy;
 * unconfigured / disabled are terminal states of their own.
 */

export type ConnectorHealthBand =
  | "healthy"
  | "degraded"
  | "failing"
  | "disabled"
  | "unconfigured"
  | "pending_first_sync";

export interface ConnectorHealthSignals {
  configured: boolean;
  enabled: boolean;
  last_sync_status: string | null;
  /** Epoch ms of the last sync, or null if never synced. */
  last_sync_at: number | null;
  consecutive_failures: number;
  /** Minutes between scheduled syncs, or null = manual-only. */
  sync_interval_minutes: number | null;
  /** Epoch ms the next scheduled sync is due, or null. */
  next_sync_at: number | null;
  stale_observations: number;
  writeback_pending: number;
  writeback_conflict: number;
  writeback_failed: number;
  open_dead_letters: number;
  /** Epoch ms "now" (injected for determinism). */
  now: number;
}

export interface ConnectorHealthAssessment {
  band: ConnectorHealthBand;
  /** Stable machine-readable reason codes (sorted). */
  reasons: string[];
  /** 0 (healthy) → 3 (failing); for rollup/sorting. */
  severity: number;
}

const SEVERITY: Record<ConnectorHealthBand, number> = {
  healthy: 0,
  unconfigured: 0,
  disabled: 1,
  pending_first_sync: 1,
  degraded: 2,
  failing: 3
};

/** Repeated-failure threshold that escalates degraded → failing. */
export const FAILING_FAILURE_STREAK = 3;
/** Overdue grace as a multiple of the schedule interval. */
export const OVERDUE_INTERVAL_MULTIPLE = 2;

export function assessConnectorHealth(s: ConnectorHealthSignals): ConnectorHealthAssessment {
  if (!s.configured) return { band: "unconfigured", reasons: [], severity: SEVERITY.unconfigured };
  if (!s.enabled) return { band: "disabled", reasons: ["connector_disabled"], severity: SEVERITY.disabled };

  const reasons = new Set<string>();
  let failing = false;
  let degraded = false;

  if (s.open_dead_letters > 0) {
    failing = true;
    reasons.add("dead_letters_open");
  }
  if (s.consecutive_failures >= FAILING_FAILURE_STREAK) {
    failing = true;
    reasons.add("repeated_sync_failures");
  } else if (s.consecutive_failures > 0) {
    degraded = true;
    reasons.add("recent_sync_failure");
  } else if (s.last_sync_status === "failed") {
    degraded = true;
    reasons.add("last_sync_failed");
  }
  if (s.writeback_failed > 0) {
    degraded = true;
    reasons.add("writeback_failures");
  }
  if (s.writeback_conflict > 0) {
    degraded = true;
    reasons.add("writeback_conflicts");
  }
  if (s.stale_observations > 0) {
    degraded = true;
    reasons.add("drift_stale_assets");
  }
  if (
    s.sync_interval_minutes !== null &&
    s.next_sync_at !== null &&
    s.now - s.next_sync_at > s.sync_interval_minutes * 60_000 * OVERDUE_INTERVAL_MULTIPLE
  ) {
    degraded = true;
    reasons.add("sync_overdue");
  }

  let band: ConnectorHealthBand;
  if (failing) band = "failing";
  else if (degraded) band = "degraded";
  else if (s.last_sync_at === null) {
    band = "pending_first_sync";
    reasons.add("never_synced");
  } else band = "healthy";

  return { band, reasons: [...reasons].sort(), severity: SEVERITY[band] };
}

/** Worst severity across a set of assessments (org-level rollup). */
export function rollupHealth(assessments: readonly ConnectorHealthAssessment[]): ConnectorHealthBand {
  let worst: ConnectorHealthBand = "healthy";
  for (const a of assessments) {
    if (SEVERITY[a.band] > SEVERITY[worst]) worst = a.band;
  }
  return worst;
}
