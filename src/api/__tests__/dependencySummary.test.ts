import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildDependencySummary } from "../routes/dependencies.js";

// ====================================================================
// buildDependencySummary — empty rows
// ====================================================================

describe("buildDependencySummary — empty rows", () => {
  it("returns total = 0 when no rows", () => {
    const s = buildDependencySummary([], [], []);
    expect(s.total).toBe(0);
  });

  it("returns all canonical criticality keys at 0", () => {
    const { by_criticality } = buildDependencySummary([], [], []);
    expect(by_criticality["Critical"]).toBe(0);
    expect(by_criticality["High"]).toBe(0);
    expect(by_criticality["Moderate"]).toBe(0);
    expect(by_criticality["Low"]).toBe(0);
  });

  it("returns all canonical status keys at 0", () => {
    const { by_status } = buildDependencySummary([], [], []);
    expect(by_status["active"]).toBe(0);
    expect(by_status["deprecated"]).toBe(0);
    expect(by_status["under_review"]).toBe(0);
  });

  it("returns all canonical dependency_type keys at 0", () => {
    const { by_dependency_type } = buildDependencySummary([], [], []);
    expect(by_dependency_type["software_library"]).toBe(0);
    expect(by_dependency_type["cloud_service"]).toBe(0);
    expect(by_dependency_type["infrastructure"]).toBe(0);
    expect(by_dependency_type["api"]).toBe(0);
    expect(by_dependency_type["other"]).toBe(0);
  });
});

// ====================================================================
// buildDependencySummary — by_criticality
// ====================================================================

describe("buildDependencySummary — by_criticality", () => {
  it("counts Critical dependencies", () => {
    const { by_criticality } = buildDependencySummary(
      [{ criticality: "Critical", count: "3" }],
      [],
      []
    );
    expect(by_criticality["Critical"]).toBe(3);
  });

  it("counts High dependencies", () => {
    const { by_criticality } = buildDependencySummary(
      [{ criticality: "High", count: "7" }],
      [],
      []
    );
    expect(by_criticality["High"]).toBe(7);
  });

  it("counts Moderate dependencies", () => {
    const { by_criticality } = buildDependencySummary(
      [{ criticality: "Moderate", count: "2" }],
      [],
      []
    );
    expect(by_criticality["Moderate"]).toBe(2);
  });

  it("counts Low dependencies", () => {
    const { by_criticality } = buildDependencySummary(
      [{ criticality: "Low", count: "5" }],
      [],
      []
    );
    expect(by_criticality["Low"]).toBe(5);
  });

  it("absent criticality keys remain 0", () => {
    const { by_criticality } = buildDependencySummary(
      [{ criticality: "Critical", count: "1" }],
      [],
      []
    );
    expect(by_criticality["High"]).toBe(0);
    expect(by_criticality["Moderate"]).toBe(0);
    expect(by_criticality["Low"]).toBe(0);
  });

  it("ignores unrecognised criticality values", () => {
    const { by_criticality } = buildDependencySummary(
      [{ criticality: "Unknown", count: "9" }],
      [],
      []
    );
    expect("Unknown" in by_criticality).toBe(false);
  });
});

// ====================================================================
// buildDependencySummary — by_status
// ====================================================================

describe("buildDependencySummary — by_status", () => {
  it("counts active dependencies", () => {
    const { by_status } = buildDependencySummary(
      [],
      [{ status: "active", count: "10" }],
      []
    );
    expect(by_status["active"]).toBe(10);
  });

  it("counts deprecated dependencies", () => {
    const { by_status } = buildDependencySummary(
      [],
      [{ status: "deprecated", count: "4" }],
      []
    );
    expect(by_status["deprecated"]).toBe(4);
  });

  it("counts under_review dependencies", () => {
    const { by_status } = buildDependencySummary(
      [],
      [{ status: "under_review", count: "2" }],
      []
    );
    expect(by_status["under_review"]).toBe(2);
  });

  it("absent status keys remain 0", () => {
    const { by_status } = buildDependencySummary(
      [],
      [{ status: "active", count: "5" }],
      []
    );
    expect(by_status["deprecated"]).toBe(0);
    expect(by_status["under_review"]).toBe(0);
  });
});

// ====================================================================
// buildDependencySummary — total
// ====================================================================

describe("buildDependencySummary — total", () => {
  it("sums status counts into total", () => {
    const { total } = buildDependencySummary(
      [],
      [
        { status: "active", count: "8" },
        { status: "deprecated", count: "3" },
        { status: "under_review", count: "1" }
      ],
      []
    );
    expect(total).toBe(12);
  });

  it("unrecognised status rows do not contribute to total", () => {
    const { total } = buildDependencySummary(
      [],
      [
        { status: "active", count: "5" },
        { status: "unknown_status", count: "99" }
      ],
      []
    );
    expect(total).toBe(5);
  });
});

// ====================================================================
// buildDependencySummary — by_dependency_type
// ====================================================================

describe("buildDependencySummary — by_dependency_type", () => {
  it("counts software_library", () => {
    const { by_dependency_type } = buildDependencySummary(
      [],
      [],
      [{ dependency_type: "software_library", count: "6" }]
    );
    expect(by_dependency_type["software_library"]).toBe(6);
  });

  it("counts cloud_service", () => {
    const { by_dependency_type } = buildDependencySummary(
      [],
      [],
      [{ dependency_type: "cloud_service", count: "3" }]
    );
    expect(by_dependency_type["cloud_service"]).toBe(3);
  });

  it("counts infrastructure", () => {
    const { by_dependency_type } = buildDependencySummary(
      [],
      [],
      [{ dependency_type: "infrastructure", count: "2" }]
    );
    expect(by_dependency_type["infrastructure"]).toBe(2);
  });

  it("counts api", () => {
    const { by_dependency_type } = buildDependencySummary(
      [],
      [],
      [{ dependency_type: "api", count: "7" }]
    );
    expect(by_dependency_type["api"]).toBe(7);
  });

  it("counts other", () => {
    const { by_dependency_type } = buildDependencySummary(
      [],
      [],
      [{ dependency_type: "other", count: "1" }]
    );
    expect(by_dependency_type["other"]).toBe(1);
  });

  it("absent type keys remain 0", () => {
    const { by_dependency_type } = buildDependencySummary(
      [],
      [],
      [{ dependency_type: "api", count: "4" }]
    );
    expect(by_dependency_type["software_library"]).toBe(0);
    expect(by_dependency_type["cloud_service"]).toBe(0);
    expect(by_dependency_type["infrastructure"]).toBe(0);
    expect(by_dependency_type["other"]).toBe(0);
  });
});
