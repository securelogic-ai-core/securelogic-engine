import { RiskDecisionPdfRenderer } from "../../src/report/renderers/RiskDecisionPdfRenderer";
import { RiskDecisionReportV1 } from "../../src/report/contracts/RiskDecisionReportV1";

describe("RiskDecisionReport V1 Snapshot", () => {
  it("renders a stable V1 report", () => {
    const input: RiskDecisionReportV1 = {
      reportVersion: "1.0",
      generatedAt: "2025-01-01",
      assessment: {
        name: "Test Assessment",
        date: "2025-01-01"
      },
      decision: {
        score: 72,
        level: "High",
        dominantDomains: ["Governance"],
        severityRationale: ["Test rationale"],
        heatMap: [],
        remediationPlan: [],
        approvalStatus: "Rejected"
      }
    };

    const html = RiskDecisionPdfRenderer.render(input);
    expect(html).toContain("Risk Decision Report");
  });
});
