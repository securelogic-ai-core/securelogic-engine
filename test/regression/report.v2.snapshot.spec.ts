import { SecureLogicAI } from "../../src/product/SecureLogicAI";
import { EnterpriseRiskSummary } from "../../src/engine/contracts/EnterpriseRiskSummary";
import { LicenseContext } from "../../src/product/LicenseTier";

describe("ExecutiveRiskReportV2 snapshot", () => {
  it("produces a stable executive report for Enterprise license", () => {
    const summary: EnterpriseRiskSummary = {
      enterpriseRiskScore: 78,
      overallScore: 78,
      severity: "High",
      topRiskDrivers: ["Governance", "Access Control"],
      severityRationale: ["High residual access risk"],
      domainScores: [
        {
          domain: "Governance",
          score: 80,
          impact: 4,
          likelihood: 4,
          severity: "High"
        }
      ],
      categoryScores: [
        {
          category: "Governance",
          score: 80,
          severity: "High"
        }
      ],
      recommendedActions: [
        {
          id: "RA-1",
          description: "Strengthen access controls",
          estimatedRiskReduction: 20,
          priority: "Immediate"
        }
      ]
    };
git status
    const license: LicenseContext = { tier: "Enterprise" };

    const result = SecureLogicAI.runAssessment(summary, license);

    expect(result.report).toMatchSnapshot();
  });
});
