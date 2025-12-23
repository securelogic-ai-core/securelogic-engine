"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var SecureLogicAI_1 = require("../../src/product/SecureLogicAI");
describe("ExecutiveRiskReportV2 snapshot", function () {
    it("produces a stable executive report for Enterprise license", function () {
        var summary = {
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
        var license = { tier: "Enterprise" };
        var result = SecureLogicAI_1.SecureLogicAI.runAssessment(summary, license);
        expect(result.report).toMatchSnapshot();
    });
});
