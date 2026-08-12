/**
 * seatLimitPerClass.test.ts — Phase 1 of the enterprise seat program.
 *
 * Covers the pure per-class cap logic (computeDefaultSeatCap / resolveSeatCap)
 * and the enforceSeatLimitForClass query shape. The whole-org enforceSeatLimit
 * is unchanged and covered by its existing suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("../infra/postgres.js", () => ({
  pg: { query: (...a: unknown[]) => queryMock(...a) },
}));

import {
  computeDefaultSeatCap,
  resolveSeatCap,
  enforceSeatLimitForClass,
  CONTRIBUTOR_SEAT_FLOOR,
  VIEWER_SEAT_FLOOR,
} from "../lib/seatLimit.js";

describe("computeDefaultSeatCap — multipliers with floors", () => {
  it("full → the Full cap itself", () => {
    expect(computeDefaultSeatCap("full", 10)).toBe(10);
    expect(computeDefaultSeatCap("full", 6)).toBe(6);
  });

  it("contributor → max(50, 10 × full)", () => {
    expect(computeDefaultSeatCap("contributor", 6)).toBe(60); // 10×6=60 > floor
    expect(computeDefaultSeatCap("contributor", 3)).toBe(CONTRIBUTOR_SEAT_FLOOR); // 30 < 50 → floor
    expect(computeDefaultSeatCap("contributor", 10)).toBe(100);
  });

  it("viewer → max(25, 5 × full)", () => {
    expect(computeDefaultSeatCap("viewer", 10)).toBe(50); // 5×10=50 > floor
    expect(computeDefaultSeatCap("viewer", 3)).toBe(VIEWER_SEAT_FLOOR); // 15 < 25 → floor
    expect(computeDefaultSeatCap("viewer", 6)).toBe(30);
  });
});

describe("resolveSeatCap — explicit column wins, NULL falls back to computed default", () => {
  const base = { maxMembers: 10, maxContributorSeats: null, maxViewerSeats: null };

  it("full always reads max_members (default 6 when null)", () => {
    expect(resolveSeatCap("full", { ...base })).toBe(10);
    expect(resolveSeatCap("full", { maxMembers: null, maxContributorSeats: 5, maxViewerSeats: 5 })).toBe(6);
  });

  it("contributor/viewer fall back to computed default when unset", () => {
    expect(resolveSeatCap("contributor", base)).toBe(100); // 10×10
    expect(resolveSeatCap("viewer", base)).toBe(50); // 5×10
  });

  it("an explicit admin-set cap overrides the computed default", () => {
    expect(resolveSeatCap("contributor", { ...base, maxContributorSeats: 250 })).toBe(250);
    expect(resolveSeatCap("viewer", { ...base, maxViewerSeats: 5 })).toBe(5);
  });
});

describe("enforceSeatLimitForClass", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts only the named class and compares to its resolved cap", async () => {
    queryMock.mockResolvedValue({
      rows: [{ used: "60", max_members: 10, max_contributor_seats: null, max_viewer_seats: null }],
    });
    const r = await enforceSeatLimitForClass("org-1", "contributor");
    expect(r).toEqual({ seatClass: "contributor", used: 60, cap: 100, exceeded: false });

    // the query filters on seat_type = the class
    const [, params] = queryMock.mock.calls[0]!;
    expect(params).toEqual(["org-1", "contributor"]);
  });

  it("exceeded is true at the cap boundary", async () => {
    queryMock.mockResolvedValue({
      rows: [{ used: "50", max_members: 10, max_contributor_seats: 50, max_viewer_seats: null }],
    });
    const r = await enforceSeatLimitForClass("org-1", "contributor");
    expect(r.exceeded).toBe(true);
    expect(r.cap).toBe(50);
  });
});
