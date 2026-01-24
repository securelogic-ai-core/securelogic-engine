import { describe, it, expect } from "vitest";
import { DomainRiskAggregationEngineV2 } from "../DomainRiskAggregationEngineV2.js";
import type { Finding } from "../../../../reporting/ReportSchema.js";

function makeFinding(
  domain: string,
  severity: "Low" | "Moderate" | "High" | "Critical"
): Finding {
  return {
    id: crypto.randomUUID(),
    title: `${severity} issue`,
    domain,
    severity,
    evidence: "test evidence"
  } as unknown as Finding;
}

const smallContext = {
  regulated: false,
  safetyCritical: false,
  handlesPII: false,
  scale: "Small" as const
};

const mediumContext = {
  regulated: false,
  safetyCritical: false,
  handlesPII: false,
  scale: "Medium" as const
};

const enterpriseContext = {
  regulated: true,
  safetyCritical: true,
  handlesPII: true,
  scale: "Enterprise" as const
};

describe("DomainRiskAggregationEngineV2 invariants", () => {
  it("never produces scores outside 0–100", () => {
    const findings: Finding[] = [
      makeFinding("Security", "Critical"),
      makeFinding("Security", "Critical"),
      makeFinding("Security", "High"),
      makeFinding("Privacy", "Moderate")
    ];

    const result = DomainRiskAggregationEngineV2.aggregate(
      findings,
      enterpriseContext as any
    );

    for (const d of result) {
      expect(d.baseScore).toBeGreaterThanOrEqual(0);
      expect(d.baseScore).toBeLessThanOrEqual(100);
      expect(d.finalScore).toBeGreaterThanOrEqual(0);
      expect(d.finalScore).toBeLessThanOrEqual(100);
    }
  });

  it("higher severity findings must not reduce domain risk", () => {
    const low: Finding[] = [makeFinding("Security", "Low")];
    const high: Finding[] = [makeFinding("Security", "Critical")];

    const lowScore = DomainRiskAggregationEngineV2.aggregate(
      low,
      smallContext as any
    )[0]!.finalScore;

    const highScore = DomainRiskAggregationEngineV2.aggregate(
      high,
      smallContext as any
    )[0]!.finalScore;

    expect(highScore).toBeGreaterThan(lowScore);
  });

  it("adding more findings must not reduce risk", () => {
    const one: Finding[] = [makeFinding("Security", "High")];

    const many: Finding[] = [
      makeFinding("Security", "High"),
      makeFinding("Security", "High"),
      makeFinding("Security", "High")
    ];

    const oneScore = DomainRiskAggregationEngineV2.aggregate(
      one,
      mediumContext as any
    )[0]!.finalScore;

    const manyScore = DomainRiskAggregationEngineV2.aggregate(
      many,
      mediumContext as any
    )[0]!.finalScore;

    expect(manyScore).toBeGreaterThanOrEqual(oneScore);
  });
});
