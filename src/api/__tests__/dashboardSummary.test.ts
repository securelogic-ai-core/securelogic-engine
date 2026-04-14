import { describe, it, expect, vi } from "vitest";

// vi.mock is hoisted before all imports by vitest's transform.
// This prevents postgres.ts from evaluating (it throws if DATABASE_URL is unset),
// which allows the route file to be imported without a live database connection.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildFindingsBySeverity, buildInventory } from "../routes/dashboard.js";
import { buildEvidenceSummary } from "../routes/evidence.js";

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

// ====================================================================
// buildInventory — null / missing row
// ====================================================================

describe("buildInventory — null row", () => {
  it("returns all zeros when row is null", () => {
    const inv = buildInventory(null);
    expect(inv.vendors).toBe(0);
    expect(inv.ai_systems).toBe(0);
    expect(inv.controls).toBe(0);
    expect(inv.control_assessments).toBe(0);
    expect(inv.governance_reviews).toBe(0);
    expect(inv.risks).toBe(0);
    expect(inv.dependencies).toBe(0);
    expect(inv.obligations).toBe(0);
  });

  it("returns all zeros when row is undefined", () => {
    const inv = buildInventory(undefined);
    expect(inv.risks).toBe(0);
    expect(inv.dependencies).toBe(0);
    expect(inv.obligations).toBe(0);
  });
});

// ====================================================================
// buildInventory — populated row
// ====================================================================

describe("buildInventory — populated row", () => {
  const row = {
    vendors: "3",
    ai_systems: "2",
    controls: "10",
    control_assessments: "7",
    governance_reviews: "4",
    risks: "5",
    dependencies: "12",
    obligations: "8"
  };

  it("parses vendors correctly", () => {
    expect(buildInventory(row).vendors).toBe(3);
  });

  it("parses ai_systems correctly", () => {
    expect(buildInventory(row).ai_systems).toBe(2);
  });

  it("parses controls correctly", () => {
    expect(buildInventory(row).controls).toBe(10);
  });

  it("parses control_assessments correctly", () => {
    expect(buildInventory(row).control_assessments).toBe(7);
  });

  it("parses governance_reviews correctly", () => {
    expect(buildInventory(row).governance_reviews).toBe(4);
  });

  it("parses risks correctly", () => {
    expect(buildInventory(row).risks).toBe(5);
  });

  it("parses dependencies correctly", () => {
    expect(buildInventory(row).dependencies).toBe(12);
  });

  it("parses obligations correctly", () => {
    expect(buildInventory(row).obligations).toBe(8);
  });

  it("returns an object with all eight inventory keys", () => {
    const inv = buildInventory(row);
    expect(Object.keys(inv).sort()).toEqual([
      "ai_systems",
      "control_assessments",
      "controls",
      "dependencies",
      "governance_reviews",
      "obligations",
      "risks",
      "vendors"
    ]);
  });
});

// ====================================================================
// buildInventory — zero-value strings
// ====================================================================

describe("buildInventory — zero-value strings", () => {
  it("correctly parses '0' strings for all new primitive fields", () => {
    const row = {
      vendors: "0",
      ai_systems: "0",
      controls: "0",
      control_assessments: "0",
      governance_reviews: "0",
      risks: "0",
      dependencies: "0",
      obligations: "0"
    };
    const inv = buildInventory(row);
    expect(inv.risks).toBe(0);
    expect(inv.dependencies).toBe(0);
    expect(inv.obligations).toBe(0);
  });
});

// ====================================================================
// buildEvidenceSummary — dashboard usage (imported via evidence.ts)
// ====================================================================

describe("buildEvidenceSummary — dashboard usage", () => {
  it("returns total = 0 with no rows", () => {
    expect(buildEvidenceSummary([]).total).toBe(0);
  });

  it("returns all canonical source_type keys at 0 with no rows", () => {
    const { by_source_type } = buildEvidenceSummary([]);
    expect(by_source_type["control_test"]).toBe(0);
    expect(by_source_type["vendor_review"]).toBe(0);
    expect(by_source_type["ai_review"]).toBe(0);
    expect(by_source_type["ai_governance_review"]).toBe(0);
    expect(by_source_type["obligation_review"]).toBe(0);
    expect(by_source_type["dependency_review"]).toBe(0);
    expect(by_source_type["risk_treatment"]).toBe(0);
    expect(by_source_type["finding"]).toBe(0);
  });

  it("populates total from rows", () => {
    const { total } = buildEvidenceSummary([
      { source_type: "control_test", count: "3" },
      { source_type: "vendor_review", count: "2" }
    ]);
    expect(total).toBe(5);
  });

  it("populates individual source_type counts", () => {
    const { by_source_type } = buildEvidenceSummary([
      { source_type: "obligation_review", count: "4" }
    ]);
    expect(by_source_type["obligation_review"]).toBe(4);
  });

  it("ignores rows with unknown source_type", () => {
    const { total } = buildEvidenceSummary([
      { source_type: "unknown_type", count: "10" },
      { source_type: "control_test", count: "2" }
    ]);
    expect(total).toBe(2);
  });
});
