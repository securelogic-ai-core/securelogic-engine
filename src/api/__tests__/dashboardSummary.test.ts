import { describe, it, expect, vi } from "vitest";

// vi.mock is hoisted before all imports by vitest's transform.
// This prevents postgres.ts from evaluating (it throws if DATABASE_URL is unset),
// which allows the route file to be imported without a live database connection.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildFindingsBySeverity } from "../routes/dashboard.js";

// ====================================================================
// buildFindingsBySeverity — severity keys
// ====================================================================

describe("buildFindingsBySeverity — severity keys", () => {
  it("returns all four severity keys when no rows are present", () => {
    const { by_severity } = buildFindingsBySeverity([]);
    expect(Object.keys(by_severity).sort()).toEqual(
      ["Critical", "High", "Low", "Moderate"].sort()
    );
  });

  it("defaults all four severity values to 0 when no rows are present", () => {
    const { by_severity } = buildFindingsBySeverity([]);
    expect(by_severity["Critical"]).toBe(0);
    expect(by_severity["High"]).toBe(0);
    expect(by_severity["Moderate"]).toBe(0);
    expect(by_severity["Low"]).toBe(0);
  });

  it("populates Critical count from DB row", () => {
    const { by_severity } = buildFindingsBySeverity([
      { severity: "Critical", count: "3" }
    ]);
    expect(by_severity["Critical"]).toBe(3);
  });

  it("populates High count from DB row", () => {
    const { by_severity } = buildFindingsBySeverity([
      { severity: "High", count: "7" }
    ]);
    expect(by_severity["High"]).toBe(7);
  });

  it("populates Moderate count from DB row", () => {
    const { by_severity } = buildFindingsBySeverity([
      { severity: "Moderate", count: "2" }
    ]);
    expect(by_severity["Moderate"]).toBe(2);
  });

  it("populates Low count from DB row", () => {
    const { by_severity } = buildFindingsBySeverity([
      { severity: "Low", count: "5" }
    ]);
    expect(by_severity["Low"]).toBe(5);
  });

  it("populates all four severity keys correctly from four rows", () => {
    const { by_severity } = buildFindingsBySeverity([
      { severity: "Critical", count: "1" },
      { severity: "High", count: "2" },
      { severity: "Moderate", count: "3" },
      { severity: "Low", count: "4" }
    ]);
    expect(by_severity["Critical"]).toBe(1);
    expect(by_severity["High"]).toBe(2);
    expect(by_severity["Moderate"]).toBe(3);
    expect(by_severity["Low"]).toBe(4);
  });
});

// ====================================================================
// buildFindingsBySeverity — open total
// ====================================================================

describe("buildFindingsBySeverity — open total", () => {
  it("returns open = 0 when no rows", () => {
    const { open } = buildFindingsBySeverity([]);
    expect(open).toBe(0);
  });

  it("returns open = count of the single row", () => {
    const { open } = buildFindingsBySeverity([
      { severity: "Critical", count: "4" }
    ]);
    expect(open).toBe(4);
  });

  it("sums open across all severity rows", () => {
    const { open } = buildFindingsBySeverity([
      { severity: "Critical", count: "1" },
      { severity: "High", count: "2" },
      { severity: "Moderate", count: "3" },
      { severity: "Low", count: "4" }
    ]);
    expect(open).toBe(10);
  });

  it("includes unrecognised severity in open total but not in by_severity", () => {
    const { open, by_severity } = buildFindingsBySeverity([
      { severity: "Unknown", count: "5" }
    ]);
    expect(open).toBe(5);
    expect("Unknown" in by_severity).toBe(false);
  });
});

// ====================================================================
// buildFindingsBySeverity — absent severities stay at 0
// ====================================================================

describe("buildFindingsBySeverity — absent severities stay at 0", () => {
  it("severities absent from rows remain 0 even when others are populated", () => {
    const { by_severity } = buildFindingsBySeverity([
      { severity: "Critical", count: "9" }
    ]);
    expect(by_severity["High"]).toBe(0);
    expect(by_severity["Moderate"]).toBe(0);
    expect(by_severity["Low"]).toBe(0);
  });
});
