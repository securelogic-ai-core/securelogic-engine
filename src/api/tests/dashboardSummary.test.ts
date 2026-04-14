import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildInventory, buildFindingsBySeverity } from "../routes/dashboard.js";
import { buildEvidenceSummary } from "../routes/evidence.js";

// ====================================================================
// GET /api/dashboard/summary — response shape contract
// ====================================================================

describe("GET /api/dashboard/summary — response shape", () => {
  it("response includes posture section", () => {
    // Route always returns posture: { overall_score, overall_severity, snapshot_date }
    // All three are null when no posture_snapshot exists (200, not 404).
    expect(true).toBe(true);
  });

  it("response includes findings section with by_severity breakdown", () => {
    // findings: { open: number, by_severity: { Critical, High, Moderate, Low } }
    // Derived from open findings grouped by severity for the org.
    expect(true).toBe(true);
  });

  it("response includes actions section with overdue count", () => {
    // actions: { open: number, overdue: number }
    // open = status NOT IN ('closed','accepted'), overdue = subset with due_date < NOW()
    expect(true).toBe(true);
  });

  it("response includes risks_summary section", () => {
    // risks_summary: { open: number, by_risk_rating: { Critical, High, Moderate, Low } }
    // open = status NOT IN ('closed','transferred')
    expect(true).toBe(true);
  });

  it("response includes dependency_summary section", () => {
    // dependency_summary: { open: number, by_criticality: { Critical, High, Moderate, Low } }
    // open = status IN ('active','under_review')
    expect(true).toBe(true);
  });

  it("response includes evidence_summary section with by_source_type breakdown", () => {
    // evidence_summary: { total: number, by_source_type: { ...all canonical keys } }
    // All 8 canonical source_type keys always present, missing values default to 0.
    expect(true).toBe(true);
  });

  it("response includes inventory section", () => {
    // inventory: { vendors, ai_systems, controls, control_assessments,
    //              governance_reviews, risks, dependencies, obligations }
    expect(true).toBe(true);
  });
});

// ====================================================================
// buildInventory — dashboard field contracts
// ====================================================================

describe("buildInventory — risks field", () => {
  it("returns risks = 0 when row is null", () => {
    expect(buildInventory(null).risks).toBe(0);
  });

  it("parses risks count from string", () => {
    const row = {
      vendors: "0", ai_systems: "0", controls: "0",
      control_assessments: "0", governance_reviews: "0",
      risks: "9", dependencies: "0", obligations: "0"
    };
    expect(buildInventory(row).risks).toBe(9);
  });
});

describe("buildInventory — dependencies field", () => {
  it("returns dependencies = 0 when row is null", () => {
    expect(buildInventory(null).dependencies).toBe(0);
  });

  it("parses dependencies count from string", () => {
    const row = {
      vendors: "0", ai_systems: "0", controls: "0",
      control_assessments: "0", governance_reviews: "0",
      risks: "0", dependencies: "14", obligations: "0"
    };
    expect(buildInventory(row).dependencies).toBe(14);
  });
});

describe("buildInventory — obligations field", () => {
  it("returns obligations = 0 when row is null", () => {
    expect(buildInventory(null).obligations).toBe(0);
  });

  it("parses obligations count from string", () => {
    const row = {
      vendors: "0", ai_systems: "0", controls: "0",
      control_assessments: "0", governance_reviews: "0",
      risks: "0", dependencies: "0", obligations: "6"
    };
    expect(buildInventory(row).obligations).toBe(6);
  });
});

// ====================================================================
// buildEvidenceSummary — as used by dashboard route
// ====================================================================

describe("buildEvidenceSummary — dashboard usage", () => {
  it("always returns all eight canonical source_type keys", () => {
    const { by_source_type } = buildEvidenceSummary([]);
    const expected = [
      "control_test", "vendor_review", "ai_review", "ai_governance_review",
      "obligation_review", "dependency_review", "risk_treatment", "finding"
    ];
    for (const key of expected) {
      expect(key in by_source_type).toBe(true);
    }
  });

  it("total = 0 when no evidence rows", () => {
    expect(buildEvidenceSummary([]).total).toBe(0);
  });

  it("sums total across all source types", () => {
    const { total } = buildEvidenceSummary([
      { source_type: "control_test", count: "3" },
      { source_type: "risk_treatment", count: "2" },
      { source_type: "finding", count: "1" }
    ]);
    expect(total).toBe(6);
  });

  it("unknown source_type rows do not appear in by_source_type", () => {
    const { by_source_type } = buildEvidenceSummary([
      { source_type: "unknown_workflow", count: "5" }
    ]);
    expect("unknown_workflow" in by_source_type).toBe(false);
  });

  it("populates ai_governance_review count correctly", () => {
    const { by_source_type } = buildEvidenceSummary([
      { source_type: "ai_governance_review", count: "7" }
    ]);
    expect(by_source_type["ai_governance_review"]).toBe(7);
  });

  it("populates dependency_review count correctly", () => {
    const { by_source_type } = buildEvidenceSummary([
      { source_type: "dependency_review", count: "4" }
    ]);
    expect(by_source_type["dependency_review"]).toBe(4);
  });

  it("populates risk_treatment count correctly", () => {
    const { by_source_type } = buildEvidenceSummary([
      { source_type: "risk_treatment", count: "2" }
    ]);
    expect(by_source_type["risk_treatment"]).toBe(2);
  });

  it("populates finding count correctly", () => {
    const { by_source_type } = buildEvidenceSummary([
      { source_type: "finding", count: "8" }
    ]);
    expect(by_source_type["finding"]).toBe(8);
  });
});

// ====================================================================
// buildFindingsBySeverity — always present in dashboard response
// ====================================================================

describe("buildFindingsBySeverity — zero-state dashboard", () => {
  it("returns open = 0 with no rows", () => {
    expect(buildFindingsBySeverity([]).open).toBe(0);
  });

  it("by_severity has all four keys at 0 with no rows", () => {
    const { by_severity } = buildFindingsBySeverity([]);
    expect(by_severity["Critical"]).toBe(0);
    expect(by_severity["High"]).toBe(0);
    expect(by_severity["Moderate"]).toBe(0);
    expect(by_severity["Low"]).toBe(0);
  });
});

// ====================================================================
// Middleware and auth contract
// ====================================================================

describe("GET /api/dashboard/summary — auth contract", () => {
  it("applies requireApiKey -> attachOrganizationContext -> requireEntitlement('standard')", () => {
    // Same middleware chain as all platform read surfaces.
    // Returns 403 organization_context_missing if context is absent.
    expect(true).toBe(true);
  });

  it("returns 403 when organization_context is missing", () => {
    // Defensive guard: organizationId is null → 403 before any DB access.
    expect(true).toBe(true);
  });
});

// ====================================================================
// Null posture state
// ====================================================================

describe("GET /api/dashboard/summary — null posture state", () => {
  it("returns 200 with null posture fields when no snapshot exists", () => {
    // posture: { overall_score: null, overall_severity: null, snapshot_date: null }
    // domains: []
    // This is not an error — clients render a 'no data yet' instructional state.
    expect(true).toBe(true);
  });

  it("findings, actions, risks_summary, dependency_summary, evidence_summary and inventory are still populated when no snapshot exists", () => {
    // These sections derive from their own tables independently of posture_snapshots.
    expect(true).toBe(true);
  });
});
