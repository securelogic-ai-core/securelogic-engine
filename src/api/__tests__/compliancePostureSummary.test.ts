import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildComplianceSummary } from "../routes/posture.js";

// ====================================================================
// buildComplianceSummary — empty inputs
// ====================================================================

describe("buildComplianceSummary — empty inputs", () => {
  it("returns obligation total = 0 with no rows", () => {
    expect(buildComplianceSummary([], []).obligations.total).toBe(0);
  });

  it("returns all canonical obligation status keys at 0", () => {
    const { by_status } = buildComplianceSummary([], []).obligations;
    expect(by_status["active"]).toBe(0);
    expect(by_status["waived"]).toBe(0);
    expect(by_status["not_applicable"]).toBe(0);
  });

  it("returns assessment total = 0 with no rows", () => {
    expect(buildComplianceSummary([], []).assessments.total).toBe(0);
  });

  it("returns all canonical assessment status keys at 0", () => {
    const { by_status } = buildComplianceSummary([], []).assessments;
    expect(by_status["not_started"]).toBe(0);
    expect(by_status["in_progress"]).toBe(0);
    expect(by_status["compliant"]).toBe(0);
    expect(by_status["non_compliant"]).toBe(0);
    expect(by_status["partially_compliant"]).toBe(0);
  });

  it("returns open_compliance_concerns = 0 with no rows", () => {
    expect(buildComplianceSummary([], []).open_compliance_concerns).toBe(0);
  });
});

// ====================================================================
// buildComplianceSummary — obligation counts
// ====================================================================

describe("buildComplianceSummary — obligation by_status", () => {
  it("counts active obligations", () => {
    const { by_status } = buildComplianceSummary(
      [{ status: "active", count: "10" }],
      []
    ).obligations;
    expect(by_status["active"]).toBe(10);
  });

  it("counts waived obligations", () => {
    const { by_status } = buildComplianceSummary(
      [{ status: "waived", count: "3" }],
      []
    ).obligations;
    expect(by_status["waived"]).toBe(3);
  });

  it("counts not_applicable obligations", () => {
    const { by_status } = buildComplianceSummary(
      [{ status: "not_applicable", count: "2" }],
      []
    ).obligations;
    expect(by_status["not_applicable"]).toBe(2);
  });

  it("ignores unrecognised obligation status values", () => {
    const { total } = buildComplianceSummary(
      [{ status: "unknown", count: "5" }],
      []
    ).obligations;
    expect(total).toBe(0);
  });

  it("sums total across all obligation statuses", () => {
    const { total } = buildComplianceSummary(
      [
        { status: "active", count: "8" },
        { status: "waived", count: "2" },
        { status: "not_applicable", count: "1" }
      ],
      []
    ).obligations;
    expect(total).toBe(11);
  });
});

// ====================================================================
// buildComplianceSummary — assessment counts
// ====================================================================

describe("buildComplianceSummary — assessment by_status", () => {
  it("counts compliant assessments", () => {
    const { by_status } = buildComplianceSummary(
      [],
      [{ status: "compliant", count: "6" }]
    ).assessments;
    expect(by_status["compliant"]).toBe(6);
  });

  it("counts non_compliant assessments", () => {
    const { by_status } = buildComplianceSummary(
      [],
      [{ status: "non_compliant", count: "4" }]
    ).assessments;
    expect(by_status["non_compliant"]).toBe(4);
  });

  it("counts partially_compliant assessments", () => {
    const { by_status } = buildComplianceSummary(
      [],
      [{ status: "partially_compliant", count: "2" }]
    ).assessments;
    expect(by_status["partially_compliant"]).toBe(2);
  });

  it("counts not_started assessments", () => {
    const { by_status } = buildComplianceSummary(
      [],
      [{ status: "not_started", count: "5" }]
    ).assessments;
    expect(by_status["not_started"]).toBe(5);
  });

  it("counts in_progress assessments", () => {
    const { by_status } = buildComplianceSummary(
      [],
      [{ status: "in_progress", count: "3" }]
    ).assessments;
    expect(by_status["in_progress"]).toBe(3);
  });

  it("ignores unrecognised assessment status values", () => {
    const { total } = buildComplianceSummary(
      [],
      [{ status: "unknown_status", count: "9" }]
    ).assessments;
    expect(total).toBe(0);
  });

  it("sums total across all assessment statuses", () => {
    const { total } = buildComplianceSummary(
      [],
      [
        { status: "compliant", count: "5" },
        { status: "non_compliant", count: "3" },
        { status: "partially_compliant", count: "2" },
        { status: "not_started", count: "4" },
        { status: "in_progress", count: "1" }
      ]
    ).assessments;
    expect(total).toBe(15);
  });
});

// ====================================================================
// buildComplianceSummary — open_compliance_concerns
// ====================================================================

describe("buildComplianceSummary — open_compliance_concerns", () => {
  it("is non_compliant + partially_compliant", () => {
    const { open_compliance_concerns } = buildComplianceSummary(
      [],
      [
        { status: "non_compliant", count: "4" },
        { status: "partially_compliant", count: "2" }
      ]
    );
    expect(open_compliance_concerns).toBe(6);
  });

  it("is 0 when only compliant assessments exist", () => {
    const { open_compliance_concerns } = buildComplianceSummary(
      [],
      [{ status: "compliant", count: "8" }]
    );
    expect(open_compliance_concerns).toBe(0);
  });

  it("counts only non_compliant when partially_compliant is absent", () => {
    const { open_compliance_concerns } = buildComplianceSummary(
      [],
      [{ status: "non_compliant", count: "3" }]
    );
    expect(open_compliance_concerns).toBe(3);
  });

  it("counts only partially_compliant when non_compliant is absent", () => {
    const { open_compliance_concerns } = buildComplianceSummary(
      [],
      [{ status: "partially_compliant", count: "5" }]
    );
    expect(open_compliance_concerns).toBe(5);
  });

  it("does not include not_started or in_progress in open concerns", () => {
    const { open_compliance_concerns } = buildComplianceSummary(
      [],
      [
        { status: "not_started", count: "10" },
        { status: "in_progress", count: "5" }
      ]
    );
    expect(open_compliance_concerns).toBe(0);
  });

  it("is deterministic — same inputs produce same output", () => {
    const rows = [
      { status: "non_compliant", count: "3" },
      { status: "partially_compliant", count: "2" }
    ];
    const r1 = buildComplianceSummary([], rows);
    const r2 = buildComplianceSummary([], rows);
    expect(r1.open_compliance_concerns).toBe(r2.open_compliance_concerns);
  });
});

// ====================================================================
// buildComplianceSummary — response structure
// ====================================================================

describe("buildComplianceSummary — response structure", () => {
  it("returns obligations, assessments, and open_compliance_concerns keys", () => {
    const result = buildComplianceSummary([], []);
    expect("obligations" in result).toBe(true);
    expect("assessments" in result).toBe(true);
    expect("open_compliance_concerns" in result).toBe(true);
  });

  it("obligations has total and by_status", () => {
    const { obligations } = buildComplianceSummary([], []);
    expect("total" in obligations).toBe(true);
    expect("by_status" in obligations).toBe(true);
  });

  it("assessments has total and by_status", () => {
    const { assessments } = buildComplianceSummary([], []);
    expect("total" in assessments).toBe(true);
    expect("by_status" in assessments).toBe(true);
  });

  it("obligations by_status always has exactly three keys", () => {
    const { by_status } = buildComplianceSummary([], []).obligations;
    expect(Object.keys(by_status).sort()).toEqual(
      ["active", "not_applicable", "waived"].sort()
    );
  });

  it("assessments by_status always has exactly five keys", () => {
    const { by_status } = buildComplianceSummary([], []).assessments;
    expect(Object.keys(by_status).sort()).toEqual(
      ["compliant", "in_progress", "non_compliant", "not_started", "partially_compliant"].sort()
    );
  });
});
