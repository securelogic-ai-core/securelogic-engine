import { RiskDecisionEngine } from "../../src/engine/RiskDecisionEngine";
import { EnterpriseRiskSummary } from "../../src/engine/contracts/EnterpriseRiskSummary";
import { RiskSeverity } from "../../src/engine/contracts/RiskSeverity";

describe("RiskDecisionEngine regression", () => {
  it("handles undefined impact and likelihood without failing", () => {
    const summary: EnterpriseRiskSummary = {
      overallScore: 72,
      enterpriseRiskScore: 72,
      severity: RiskSeverity.High,

      domainScores: [
        {
          domain: "Security",
          score: 72,
          severity: RiskSeverity.High,
          impact: undefined,
          likelihood: undefined
        }
      ],

      categoryScores: [
        {
          category: "Security",
          score: 72,
          severity: RiskSeverity.High
        }
      ],

      topRiskDrivers: ["Unpatched systems"],
      severityRationale: ["High exposure due to missing patches"],

      recommendedActions: [
        {
          id: "RA-1",
          description: "Apply critical patches",
          estimatedRiskReduction: 20,
          priority: "Immediate"
        }
      ]
    };

    const decision = RiskDecisionEngine.generate(summary);

    expect(decision.score).toBe(72);
    expect(decision.level).toBe("High");
    expect(decision.approvalStatus).toBe("Rejected");

    expect(decision.heatMap).toHaveLength(1);
    expect(decision.heatMap[0].impact).toBe(0);
    expect(decision.heatMap[0].likelihood).toBe(0);
  });
});
