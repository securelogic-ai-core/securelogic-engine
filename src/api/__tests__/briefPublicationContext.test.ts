import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

import { capturePublicationContext } from "../lib/briefPublicationContext.js";
import type { Pool } from "pg";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(queryFn: (...args: unknown[]) => unknown): Pool {
  return { query: queryFn } as unknown as Pool;
}

const SNAPSHOT_ROW = {
  id: "snap-uuid-001",
  overall_score: 72,
  overall_severity: "Moderate",
  snapshot_date: "2026-04-12",
};

const DOMAIN_ROWS = [
  { domain: "Vendor Risk", score: 60, severity: "High", finding_count: 3, action_count: 1 },
  { domain: "AI Governance", score: 80, severity: "Low", finding_count: 1, action_count: 0 },
];

const FINDING_ROWS = [
  { severity: "Critical", count: "1" },
  { severity: "High", count: "2" },
  { severity: "Moderate", count: "3" },
];

const ACTION_ROW = { open_count: "5", overdue_count: "2" };

function makeSuccessPool(): Pool {
  let callCount = 0;
  return makePool(() => {
    callCount++;
    if (callCount === 1) return Promise.resolve({ rowCount: 1, rows: [SNAPSHOT_ROW] });
    if (callCount === 2) return Promise.resolve({ rowCount: 2, rows: DOMAIN_ROWS });
    if (callCount === 3) return Promise.resolve({ rowCount: 3, rows: FINDING_ROWS });
    return Promise.resolve({ rowCount: 1, rows: [ACTION_ROW] });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("capturePublicationContext — no snapshot", () => {
  it("returns null when no posture snapshot exists for the org", async () => {
    const pool = makePool(() =>
      Promise.resolve({ rowCount: 0, rows: [] })
    );
    const result = await capturePublicationContext("org-123", pool);
    expect(result).toBeNull();
  });
});

describe("capturePublicationContext — success path", () => {
  let result: Awaited<ReturnType<typeof capturePublicationContext>>;

  beforeEach(async () => {
    result = await capturePublicationContext("org-abc", makeSuccessPool());
  });

  it("returns a non-null object", () => {
    expect(result).not.toBeNull();
  });

  it("includes posture_snapshot_id from snapshot row", () => {
    expect(result?.posture_snapshot_id).toBe("snap-uuid-001");
  });

  it("includes overall_score and overall_severity", () => {
    expect(result?.overall_score).toBe(72);
    expect(result?.overall_severity).toBe("Moderate");
  });

  it("includes snapshot_date", () => {
    expect(result?.snapshot_date).toBe("2026-04-12");
  });

  it("includes captured_at as an ISO timestamp string", () => {
    expect(typeof result?.captured_at).toBe("string");
    expect(() => new Date(result!.captured_at)).not.toThrow();
  });

  it("includes domain rows", () => {
    expect(result?.domains).toHaveLength(2);
    expect(result?.domains[0]?.domain).toBe("Vendor Risk");
  });

  it("computes correct open finding total", () => {
    // Critical(1) + High(2) + Moderate(3) = 6
    expect(result?.findings.open).toBe(6);
  });

  it("includes all four canonical severity keys", () => {
    const keys = Object.keys(result?.findings.by_severity ?? {}).sort();
    expect(keys).toEqual(["Critical", "High", "Low", "Moderate"]);
  });

  it("populates severity counts correctly", () => {
    expect(result?.findings.by_severity.Critical).toBe(1);
    expect(result?.findings.by_severity.High).toBe(2);
    expect(result?.findings.by_severity.Moderate).toBe(3);
    expect(result?.findings.by_severity.Low).toBe(0);
  });

  it("includes open and overdue action counts", () => {
    expect(result?.actions.open).toBe(5);
    expect(result?.actions.overdue).toBe(2);
  });
});

describe("capturePublicationContext — zero findings and actions", () => {
  it("handles empty finding and action rows without throwing", async () => {
    let callCount = 0;
    const pool = makePool(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ rowCount: 1, rows: [SNAPSHOT_ROW] });
      if (callCount === 2) return Promise.resolve({ rowCount: 0, rows: [] });
      if (callCount === 3) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const result = await capturePublicationContext("org-empty", pool);
    expect(result).not.toBeNull();
    expect(result?.findings.open).toBe(0);
    expect(result?.findings.by_severity.Critical).toBe(0);
    expect(result?.actions.open).toBe(0);
    expect(result?.actions.overdue).toBe(0);
  });
});

describe("capturePublicationContext — query failure", () => {
  it("returns null when a DB query throws", async () => {
    const pool = makePool(() => Promise.reject(new Error("db down")));
    const result = await capturePublicationContext("org-fail", pool);
    expect(result).toBeNull();
  });
});
