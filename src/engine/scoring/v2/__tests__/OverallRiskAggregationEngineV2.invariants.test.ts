import { describe, it, expect } from "vitest";
import { OverallRiskAggregationEngineV2 } from "../OverallRiskAggregationEngineV2.js";
import type { DomainRiskProfileV2 } from "../DomainRiskAggregationEngineV2.js";
import type { RiskLevel } from "../../../contracts/RiskLevel.js";

function makeDomain(
  name: string,
  score: number,
  severity: RiskLevel
): DomainRiskProfileV2 {
  return {
    domain: name,
    severity,
    findingCount: 1,
    maxSeverity: severity,
    baseScore: score,
    normalizedScore: score,
    contextMultiplier: 1,
    finalScore: score,
    drivers: [`${name} driver`]
  };
}

describe("OverallRiskAggregationEngineV2 invariants", () => {
  it("never produces scores outside 0–100", () => {
    const domains = [
      makeDomain("A", 0, "Low"),
      makeDomain("B", 50, "Moderate"),
      makeDomain("C", 100, "Critical")
    ];

    const result = OverallRiskAggregationEngineV2.aggregate(domains);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("increasing a domain score must not reduce overall score", () => {
    const low = [
      makeDomain("A", 40, "Moderate"),
      makeDomain("B", 20, "Low")
    ];

    const high = [
      makeDomain("A", 80, "High"),
      makeDomain("B", 20, "Low")
    ];

    const r1 = OverallRiskAggregationEngineV2.aggregate(low);
    const r2 = OverallRiskAggregationEngineV2.aggregate(high);

    expect(r2.score).toBeGreaterThanOrEqual(r1.score);
  });

  it("adding a higher-risk domain must not reduce overall score", () => {
    const base = [
      makeDomain("A", 50, "Moderate")
    ];

    const expanded = [
      makeDomain("A", 50, "Moderate"),
      makeDomain("B", 90, "Critical")
    ];

    const r1 = OverallRiskAggregationEngineV2.aggregate(base);
    const r2 = OverallRiskAggregationEngineV2.aggregate(expanded);

    expect(r2.score).toBeGreaterThanOrEqual(r1.score);
  });

  it("overall severity must match score bands", () => {
    const cases = [
      { score: 10, expected: "Low" },
      { score: 45, expected: "Moderate" },
      { score: 70, expected: "High" },
      { score: 95, expected: "Critical" }
    ] as const;

    for (const c of cases) {
      const domains = [makeDomain("A", c.score, c.expected)];
      const r = OverallRiskAggregationEngineV2.aggregate(domains);
      expect(r.severity).toBe(c.expected);
    }
  });

  it("top domain must influence rationale", () => {
    const domains = [
      makeDomain("Payments", 30, "Moderate"),
      makeDomain("AI Safety", 90, "Critical")
    ];

    const r = OverallRiskAggregationEngineV2.aggregate(domains);

    expect(r.rationale).toContain("AI Safety");
  });
});
