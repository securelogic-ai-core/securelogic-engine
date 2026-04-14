import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildObligationSummary } from "../routes/obligations.js";

// ====================================================================
// buildObligationSummary — empty rows
// ====================================================================

describe("buildObligationSummary — empty rows", () => {
  it("returns total = 0 when no rows", () => {
    expect(buildObligationSummary([], []).total).toBe(0);
  });

  it("returns all canonical status keys at 0", () => {
    const { by_status } = buildObligationSummary([], []);
    expect(by_status["active"]).toBe(0);
    expect(by_status["waived"]).toBe(0);
    expect(by_status["not_applicable"]).toBe(0);
  });

  it("returns empty by_domain when no rows", () => {
    const { by_domain } = buildObligationSummary([], []);
    expect(Object.keys(by_domain)).toHaveLength(0);
  });
});

// ====================================================================
// buildObligationSummary — by_status
// ====================================================================

describe("buildObligationSummary — by_status", () => {
  it("counts active obligations", () => {
    const { by_status } = buildObligationSummary(
      [{ status: "active", count: "8" }],
      []
    );
    expect(by_status["active"]).toBe(8);
  });

  it("counts waived obligations", () => {
    const { by_status } = buildObligationSummary(
      [{ status: "waived", count: "3" }],
      []
    );
    expect(by_status["waived"]).toBe(3);
  });

  it("counts not_applicable obligations", () => {
    const { by_status } = buildObligationSummary(
      [{ status: "not_applicable", count: "2" }],
      []
    );
    expect(by_status["not_applicable"]).toBe(2);
  });

  it("absent status keys remain 0", () => {
    const { by_status } = buildObligationSummary(
      [{ status: "active", count: "5" }],
      []
    );
    expect(by_status["waived"]).toBe(0);
    expect(by_status["not_applicable"]).toBe(0);
  });

  it("ignores unrecognised status values", () => {
    const { by_status } = buildObligationSummary(
      [{ status: "unknown", count: "9" }],
      []
    );
    expect("unknown" in by_status).toBe(false);
  });
});

// ====================================================================
// buildObligationSummary — total
// ====================================================================

describe("buildObligationSummary — total", () => {
  it("sums all status counts into total", () => {
    const { total } = buildObligationSummary(
      [
        { status: "active", count: "6" },
        { status: "waived", count: "2" },
        { status: "not_applicable", count: "1" }
      ],
      []
    );
    expect(total).toBe(9);
  });

  it("unrecognised status rows do not contribute to total", () => {
    const { total } = buildObligationSummary(
      [
        { status: "active", count: "4" },
        { status: "unknown", count: "99" }
      ],
      []
    );
    expect(total).toBe(4);
  });
});

// ====================================================================
// buildObligationSummary — by_domain
// ====================================================================

describe("buildObligationSummary — by_domain", () => {
  it("maps domain values from rows", () => {
    const { by_domain } = buildObligationSummary(
      [],
      [
        { domain: "Privacy", count: "5" },
        { domain: "AI Governance", count: "2" }
      ]
    );
    expect(by_domain["Privacy"]).toBe(5);
    expect(by_domain["AI Governance"]).toBe(2);
  });

  it("accepts non-canonical domain values (domain is non-exhaustive)", () => {
    const { by_domain } = buildObligationSummary(
      [],
      [{ domain: "Custom Regulatory", count: "3" }]
    );
    expect(by_domain["Custom Regulatory"]).toBe(3);
  });

  it("returns as many domain keys as distinct domain rows", () => {
    const { by_domain } = buildObligationSummary(
      [],
      [
        { domain: "A", count: "1" },
        { domain: "B", count: "2" }
      ]
    );
    expect(Object.keys(by_domain)).toHaveLength(2);
  });
});
