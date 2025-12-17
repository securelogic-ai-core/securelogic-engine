import { SecureLogicAI } from "../../src/product/SecureLogicAI";
import { LicenseContext } from "../../src/product/LicenseTier";
import { EnterpriseRiskSummary } from "../../src/engine/contracts/EnterpriseRiskSummary";

const baseSummary: EnterpriseRiskSummary = {
  enterpriseRiskScore: 80,
  overallScore: 80,
  severity: "High",
  topRiskDrivers: ["Governance"],
  severityRationale: ["High residual risk"],
  domainScores: [],
  categoryScores: [],
  recommendedActions: []
};

describe("Product tier enforcement", () => {
  it("Starter receives decision only", () => {
    const result = SecureLogicAI.runAssessment(baseSummary, { tier: "Starter" });
    expect(result).toMatchSnapshot();
  });

  it("Professional excludes pricing", () => {
    const result = SecureLogicAI.runAssessment(baseSummary, { tier: "Professional" });
    expect(result).toMatchSnapshot();
  });

  it("Enterprise includes full report", () => {
    const result = SecureLogicAI.runAssessment(baseSummary, { tier: "Enterprise" });
    expect(result).toMatchSnapshot();
  });
});
