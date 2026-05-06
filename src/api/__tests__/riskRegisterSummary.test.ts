import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildRiskSummary } from "../routes/risks.js";

// ====================================================================
// buildRiskSummary — all-empty input
// ====================================================================

describe("buildRiskSummary — empty rows", () => {
  it("returns total = 0 when no rows", () => {
    const s = buildRiskSummary([], [], []);
    expect(s.total).toBe(0);
  });

  it("returns open_critical_count = 0 when no rows", () => {
    const s = buildRiskSummary([], [], []);
    expect(s.open_critical_count).toBe(0);
  });

  it("returns all canonical status keys at 0", () => {
    const { by_status } = buildRiskSummary([], [], []);
    expect(by_status["open"]).toBe(0);
    expect(by_status["accepted"]).toBe(0);
    expect(by_status["mitigated"]).toBe(0);
    expect(by_status["closed"]).toBe(0);
    expect(by_status["transferred"]).toBe(0);
  });

  it("returns all canonical rating keys at 0", () => {
    const { by_risk_rating } = buildRiskSummary([], [], []);
    expect(by_risk_rating["Critical"]).toBe(0);
    expect(by_risk_rating["High"]).toBe(0);
    expect(by_risk_rating["Moderate"]).toBe(0);
    expect(by_risk_rating["Low"]).toBe(0);
  });

  it("returns empty by_domain when no rows", () => {
    const { by_domain } = buildRiskSummary([], [], []);
    expect(Object.keys(by_domain)).toHaveLength(0);
  });
});

// ====================================================================
// buildRiskSummary — by_status
// ====================================================================

describe("buildRiskSummary — by_status", () => {
  it("counts open risks", () => {
    const { by_status } = buildRiskSummary(
      [{ status: "open", count: "7" }],
      [],
      []
    );
    expect(by_status["open"]).toBe(7);
  });

  it("counts accepted risks", () => {
    const { by_status } = buildRiskSummary(
      [{ status: "accepted", count: "3" }],
      [],
      []
    );
    expect(by_status["accepted"]).toBe(3);
  });

  it("counts mitigated risks", () => {
    const { by_status } = buildRiskSummary(
      [{ status: "mitigated", count: "2" }],
      [],
      []
    );
    expect(by_status["mitigated"]).toBe(2);
  });

  it("counts closed risks", () => {
    const { by_status } = buildRiskSummary(
      [{ status: "closed", count: "5" }],
      [],
      []
    );
    expect(by_status["closed"]).toBe(5);
  });

  it("counts transferred risks", () => {
    const { by_status } = buildRiskSummary(
      [{ status: "transferred", count: "1" }],
      [],
      []
    );
    expect(by_status["transferred"]).toBe(1);
  });

  it("ignores unrecognised status values in by_status", () => {
    const { by_status } = buildRiskSummary(
      [{ status: "unknown_status", count: "4" }],
      [],
      []
    );
    expect("unknown_status" in by_status).toBe(false);
  });

  it("absent statuses remain 0 when others are populated", () => {
    const { by_status } = buildRiskSummary(
      [{ status: "open", count: "9" }],
      [],
      []
    );
    expect(by_status["accepted"]).toBe(0);
    expect(by_status["mitigated"]).toBe(0);
    expect(by_status["closed"]).toBe(0);
    expect(by_status["transferred"]).toBe(0);
  });
});

// ====================================================================
// buildRiskSummary — total
// ====================================================================

describe("buildRiskSummary — total", () => {
  it("sums all status counts into total", () => {
    const { total } = buildRiskSummary(
      [
        { status: "open", count: "3" },
        { status: "accepted", count: "2" },
        { status: "mitigated", count: "1" },
        { status: "closed", count: "4" },
        { status: "transferred", count: "1" }
      ],
      [],
      []
    );
    expect(total).toBe(11);
  });

  it("unrecognised status rows do not contribute to total", () => {
    const { total } = buildRiskSummary(
      [
        { status: "open", count: "5" },
        { status: "unknown", count: "99" }
      ],
      [],
      []
    );
    expect(total).toBe(5);
  });
});

// ====================================================================
// buildRiskSummary — by_risk_rating
// ====================================================================

describe("buildRiskSummary — by_risk_rating", () => {
  it("counts Critical risks", () => {
    const { by_risk_rating } = buildRiskSummary(
      [],
      [{ risk_rating: "Critical", count: "4" }],
      []
    );
    expect(by_risk_rating["Critical"]).toBe(4);
  });

  it("counts High risks", () => {
    const { by_risk_rating } = buildRiskSummary(
      [],
      [{ risk_rating: "High", count: "6" }],
      []
    );
    expect(by_risk_rating["High"]).toBe(6);
  });

  it("counts Moderate risks", () => {
    const { by_risk_rating } = buildRiskSummary(
      [],
      [{ risk_rating: "Moderate", count: "8" }],
      []
    );
    expect(by_risk_rating["Moderate"]).toBe(8);
  });

  it("counts Low risks", () => {
    const { by_risk_rating } = buildRiskSummary(
      [],
      [{ risk_rating: "Low", count: "2" }],
      []
    );
    expect(by_risk_rating["Low"]).toBe(2);
  });

  it("absent ratings remain 0 when others are populated", () => {
    const { by_risk_rating } = buildRiskSummary(
      [],
      [{ risk_rating: "Critical", count: "3" }],
      []
    );
    expect(by_risk_rating["High"]).toBe(0);
    expect(by_risk_rating["Moderate"]).toBe(0);
    expect(by_risk_rating["Low"]).toBe(0);
  });
});

// ====================================================================
// buildRiskSummary — open_critical_count
// ====================================================================

describe("buildRiskSummary — open_critical_count", () => {
  // open_critical_count reads RESIDUAL count per Decision §3 — NOT
  // legacy `by_risk_rating`. These tests assert the residual
  // semantic explicitly so a future package that decouples legacy
  // from residual cannot silently regress this number.
  it("equals the Critical residual_rating count", () => {
    const { open_critical_count } = buildRiskSummary(
      [],
      [],
      [],
      [],
      [{ residual_rating: "Critical", count: "5" }]
    );
    expect(open_critical_count).toBe(5);
  });

  it("is 0 when no Critical residual risks exist", () => {
    const { open_critical_count } = buildRiskSummary(
      [],
      [],
      [],
      [],
      [{ residual_rating: "High", count: "3" }]
    );
    expect(open_critical_count).toBe(0);
  });

  it("ignores legacy by_risk_rating Critical count when residual is empty (no hidden coupling)", () => {
    // If a future package decouples legacy from residual, legacy
    // could carry a Critical count while residual carries none —
    // and open_critical_count must reflect residual, not legacy.
    // This test asserts the read site is residual-only.
    const { open_critical_count } = buildRiskSummary(
      [],
      [{ risk_rating: "Critical", count: "99" }], // legacy says 99
      [],
      [],
      [] // residual is empty
    );
    expect(open_critical_count).toBe(0);
  });
});

// ====================================================================
// buildRiskSummary — by_domain
// ====================================================================

describe("buildRiskSummary — by_domain", () => {
  it("maps domain values from rows", () => {
    const { by_domain } = buildRiskSummary(
      [],
      [],
      [
        { domain: "Vendor Risk", count: "4" },
        { domain: "AI Governance", count: "2" }
      ]
    );
    expect(by_domain["Vendor Risk"]).toBe(4);
    expect(by_domain["AI Governance"]).toBe(2);
  });

  it("accepts non-canonical domain values (domain is non-exhaustive)", () => {
    const { by_domain } = buildRiskSummary(
      [],
      [],
      [{ domain: "Physical Security", count: "1" }]
    );
    expect(by_domain["Physical Security"]).toBe(1);
  });

  it("returns as many domain keys as there are distinct domain rows", () => {
    const { by_domain } = buildRiskSummary(
      [],
      [],
      [
        { domain: "A", count: "1" },
        { domain: "B", count: "2" },
        { domain: "C", count: "3" }
      ]
    );
    expect(Object.keys(by_domain)).toHaveLength(3);
  });
});

// ====================================================================
// Phase 2 of risk-register-inherent-residual-rating —
// inherent + residual aggregate shape on /api/risks/summary
// ====================================================================

describe("buildRiskSummary — by_inherent_rating", () => {
  it("returns the standard four-key shape with all zeros when no rows passed", () => {
    const { by_inherent_rating } = buildRiskSummary([], [], []);
    expect(by_inherent_rating).toEqual({
      Critical: 0, High: 0, Moderate: 0, Low: 0
    });
  });

  it("populates from byInherentRatingRows", () => {
    const { by_inherent_rating } = buildRiskSummary(
      [],
      [],
      [],
      [
        { inherent_rating: "Critical", count: "5" },
        { inherent_rating: "High",     count: "3" },
        { inherent_rating: "Moderate", count: "1" },
      ],
      []
    );
    expect(by_inherent_rating).toEqual({
      Critical: 5, High: 3, Moderate: 1, Low: 0
    });
  });

  it("ignores unknown rating keys defensively", () => {
    const { by_inherent_rating } = buildRiskSummary(
      [], [], [],
      [{ inherent_rating: "Severe", count: "99" }],
      []
    );
    expect(by_inherent_rating.Critical).toBe(0);
  });
});

describe("buildRiskSummary — by_residual_rating", () => {
  it("returns the standard four-key shape with all zeros when no rows passed", () => {
    const { by_residual_rating } = buildRiskSummary([], [], []);
    expect(by_residual_rating).toEqual({
      Critical: 0, High: 0, Moderate: 0, Low: 0
    });
  });

  it("populates from byResidualRatingRows", () => {
    const { by_residual_rating } = buildRiskSummary(
      [], [], [], [],
      [
        { residual_rating: "Critical", count: "2" },
        { residual_rating: "Low",      count: "7" },
      ]
    );
    expect(by_residual_rating).toEqual({
      Critical: 2, High: 0, Moderate: 0, Low: 7
    });
  });

  it("ignores unknown rating keys defensively", () => {
    const { by_residual_rating } = buildRiskSummary(
      [], [], [], [],
      [{ residual_rating: "Negligible", count: "99" }]
    );
    expect(by_residual_rating.Low).toBe(0);
  });
});

describe("buildRiskSummary — backwards-compat: by_risk_rating preserved", () => {
  it("by_risk_rating mirrors byRatingRows input independently of inherent/residual", () => {
    // Phase-1 backfill made legacy column = residual on every write,
    // so byRatingRows and byResidualRatingRows are typically the same
    // numbers in practice. The buildRiskSummary helper, however,
    // accepts them as independent inputs — letting callers pass
    // either or both without coupling.
    const { by_risk_rating, by_residual_rating } = buildRiskSummary(
      [],
      [{ risk_rating: "High", count: "4" }],
      [], [],
      [{ residual_rating: "High", count: "4" }]
    );
    expect(by_risk_rating).toEqual({ Critical: 0, High: 4, Moderate: 0, Low: 0 });
    expect(by_residual_rating).toEqual({ Critical: 0, High: 4, Moderate: 0, Low: 0 });
  });
});
