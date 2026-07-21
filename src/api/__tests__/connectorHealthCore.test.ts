/**
 * connectorHealthCore.test.ts — ERIP E2c: the pure connector-health assessment.
 * Every band, reason precedence, overdue math, and the org rollup.
 */

import { describe, expect, it } from "vitest";
import {
  assessConnectorHealth,
  rollupHealth,
  type ConnectorHealthSignals
} from "../lib/connectorHealthCore.js";

const NOW = 1_700_000_000_000;
function signals(over: Partial<ConnectorHealthSignals> = {}): ConnectorHealthSignals {
  return {
    configured: true, enabled: true, last_sync_status: "succeeded", last_sync_at: NOW - 1000,
    consecutive_failures: 0, sync_interval_minutes: null, next_sync_at: null,
    stale_observations: 0, writeback_pending: 0, writeback_conflict: 0, writeback_failed: 0,
    open_dead_letters: 0, now: NOW, ...over
  };
}

describe("assessConnectorHealth — terminal states", () => {
  it("unconfigured when no config", () => {
    expect(assessConnectorHealth(signals({ configured: false })).band).toBe("unconfigured");
  });
  it("disabled when configured but not enabled", () => {
    const a = assessConnectorHealth(signals({ enabled: false }));
    expect(a.band).toBe("disabled");
    expect(a.reasons).toEqual(["connector_disabled"]);
  });
  it("pending_first_sync when enabled and never synced", () => {
    const a = assessConnectorHealth(signals({ last_sync_at: null, last_sync_status: null }));
    expect(a.band).toBe("pending_first_sync");
    expect(a.reasons).toContain("never_synced");
  });
  it("healthy when enabled, last sync succeeded, no issues", () => {
    const a = assessConnectorHealth(signals());
    expect(a.band).toBe("healthy");
    expect(a.reasons).toEqual([]);
    expect(a.severity).toBe(0);
  });
});

describe("assessConnectorHealth — failing", () => {
  it("open dead-letters → failing", () => {
    const a = assessConnectorHealth(signals({ open_dead_letters: 1 }));
    expect(a.band).toBe("failing");
    expect(a.reasons).toContain("dead_letters_open");
    expect(a.severity).toBe(3);
  });
  it("failure streak ≥ 3 → failing", () => {
    const a = assessConnectorHealth(signals({ consecutive_failures: 3, last_sync_status: "failed" }));
    expect(a.band).toBe("failing");
    expect(a.reasons).toContain("repeated_sync_failures");
  });
});

describe("assessConnectorHealth — degraded", () => {
  it("1–2 recent failures → degraded", () => {
    const a = assessConnectorHealth(signals({ consecutive_failures: 1, last_sync_status: "failed" }));
    expect(a.band).toBe("degraded");
    expect(a.reasons).toContain("recent_sync_failure");
  });
  it("writeback conflicts/failures and drift → degraded with all reasons", () => {
    const a = assessConnectorHealth(signals({ writeback_conflict: 2, writeback_failed: 1, stale_observations: 5 }));
    expect(a.band).toBe("degraded");
    expect(a.reasons).toEqual(expect.arrayContaining(["writeback_conflicts", "writeback_failures", "drift_stale_assets"]));
  });
  it("overdue past 2× the interval → degraded", () => {
    const a = assessConnectorHealth(signals({
      sync_interval_minutes: 60,
      next_sync_at: NOW - 60 * 60_000 * 3 // 3h late on a 1h schedule
    }));
    expect(a.band).toBe("degraded");
    expect(a.reasons).toContain("sync_overdue");
  });
  it("not overdue within the grace window", () => {
    const a = assessConnectorHealth(signals({ sync_interval_minutes: 60, next_sync_at: NOW - 60 * 60_000 }));
    expect(a.reasons).not.toContain("sync_overdue");
    expect(a.band).toBe("healthy");
  });
});

describe("rollupHealth", () => {
  it("returns the worst band across connectors", () => {
    expect(rollupHealth([
      assessConnectorHealth(signals()),
      assessConnectorHealth(signals({ stale_observations: 1 })), // degraded
      assessConnectorHealth(signals({ open_dead_letters: 1 })) // failing
    ])).toBe("failing");
  });
  it("healthy when all healthy", () => {
    expect(rollupHealth([assessConnectorHealth(signals()), assessConnectorHealth(signals())])).toBe("healthy");
  });
});
