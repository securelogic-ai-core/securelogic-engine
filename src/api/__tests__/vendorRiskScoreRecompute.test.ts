import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPgQuery, mockWithTenant } = vi.hoisted(() => ({
  mockPgQuery: vi.fn(),
  // Executes the body immediately so schedule* paths are testable in-line.
  mockWithTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: mockPgQuery },
  withTenant: mockWithTenant,
}));

import {
  resolveVendorIdForFinding,
  recomputeAndPersistVendorRiskScore,
  scheduleVendorScoreRecomputeForFinding,
} from "../lib/vendorRiskScoreRecompute.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const FINDING = "66666666-6666-4666-8666-666666666666";

/** Let setImmediate-scheduled work run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockPgQuery.mockReset();
  mockWithTenant.mockClear();
});

describe("resolveVendorIdForFinding", () => {
  it("resolves the vendor through ANY of the three vendor linkages", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ vendor_id: VENDOR }] });

    const vendorId = await resolveVendorIdForFinding(ORG, FINDING);

    expect(vendorId).toBe(VENDOR);
    const [sql, params] = mockPgQuery.mock.calls[0]!;
    expect(String(sql)).toMatch(/source_type = 'vendor_review'/);
    expect(String(sql)).toMatch(/source_type = 'vendor_cycle_review'/);
    // The third arm. Its absence is what returned NULL for every CUEC-promoted
    // Vendor Assurance finding, so no recompute was ever scheduled for one.
    expect(String(sql)).toMatch(/promoted_finding_id = f\.id/);
    // Org scoping now sits on the linkage subquery, which carries the predicate
    // on BOTH sides of every join inside it.
    expect(String(sql)).toMatch(/l\.organization_id = \$2/);
    // The FK-enforced arm wins if a finding somehow matches more than one.
    expect(String(sql)).toMatch(/WHEN 'vendor_assurance_cuec' THEN 0/);
    expect(params).toEqual([FINDING, ORG]);
  });

  it("returns null for a finding that is not vendor-workflow-sourced", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ vendor_id: null }] });
    expect(await resolveVendorIdForFinding(ORG, FINDING)).toBeNull();
  });
});

describe("recomputeAndPersistVendorRiskScore", () => {
  it("computes over BOTH vendor workflows' ACTIVE findings and persists", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ criticality: "high" }] }) // vendor SELECT
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { severity: "Critical", status: "open" },
          { severity: "High", status: "in_progress" },
        ],
      }) // findings UNION SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // vendors UPDATE

    const result = await recomputeAndPersistVendorRiskScore(ORG, VENDOR);

    // 100 - 25 (high criticality) - 20 (Critical) - 12 (High) = 43 → High Risk.
    expect(result).toEqual({
      vendor_id: VENDOR,
      score: 43,
      risk_level: "High Risk",
      finding_count: 2,
      criticality: "high",
    });

    const unionSql = String(mockPgQuery.mock.calls[1]![0]);
    expect(unionSql).toMatch(/JOIN vendor_assessments/);
    expect(unionSql).toMatch(/JOIN vendor_reviews/);
    expect(unionSql).toMatch(/JOIN vendor_assurance_cuecs/);
    expect(unionSql).toMatch(/UNION ALL/);
    // DISTINCT over the edges: a finding cannot contribute its severity to the
    // same vendor twice, however many arms it matches.
    expect(unionSql).toMatch(/SELECT DISTINCT finding_id/);

    const [updateSql, updateParams] = mockPgQuery.mock.calls[2]!;
    expect(String(updateSql)).toMatch(/UPDATE vendors SET current_risk_score/);
    expect(updateParams).toEqual([43, VENDOR, ORG]);
  });

  it("returns null and writes nothing when the vendor is not in the org", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    expect(await recomputeAndPersistVendorRiskScore(ORG, VENDOR)).toBeNull();
    expect(mockPgQuery).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleVendorScoreRecomputeForFinding", () => {
  it("resolves the finding's vendor in its own tenant scope and persists the refreshed score", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ vendor_id: VENDOR }] })   // resolve
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ criticality: "low" }] })  // vendor SELECT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                        // findings (none active)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });                       // UPDATE

    scheduleVendorScoreRecomputeForFinding(ORG, FINDING);
    await settle();

    expect(mockWithTenant).toHaveBeenCalledWith(ORG, expect.any(Function));
    // 100 - 5 (low criticality) - 0 findings = 95: remediation visibly pays off.
    const [, updateParams] = mockPgQuery.mock.calls[3]!;
    expect(updateParams).toEqual([95, VENDOR, ORG]);
  });

  it("is a no-op past resolution for non-vendor findings", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ vendor_id: null }] });

    scheduleVendorScoreRecomputeForFinding(ORG, FINDING);
    await settle();

    expect(mockPgQuery).toHaveBeenCalledTimes(1);
  });

  it("swallows failures — a score refresh can never break the caller", async () => {
    mockPgQuery.mockRejectedValueOnce(new Error("db down"));

    scheduleVendorScoreRecomputeForFinding(ORG, FINDING);
    await settle();
    // No unhandled rejection = pass; the warn log is the only side effect.
  });
});
