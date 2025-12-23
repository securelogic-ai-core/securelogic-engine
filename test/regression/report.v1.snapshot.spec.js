"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var RiskDecisionPdfRenderer_1 = require("../../src/report/renderers/RiskDecisionPdfRenderer");
describe("RiskDecisionReport V1 Snapshot", function () {
    it("renders a stable V1 report", function () {
        var input = {
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
        var html = RiskDecisionPdfRenderer_1.RiskDecisionPdfRenderer.render(input);
        expect(html).toContain("Risk Decision Report");
    });
});
