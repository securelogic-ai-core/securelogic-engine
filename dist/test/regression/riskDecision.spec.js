"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const RiskSeverity_1 = require("../../src/engine/contracts/RiskSeverity");
const RiskDecisionEngine_1 = require("../../src/engine/RiskDecisionEngine");
describe("RiskDecisionEngine regression", () => {
    it("handles undefined impact and likelihood without failing", () => {
        const summary = {
            overallScore: 72,
            enterpriseRiskScore: 72,
            severity: RiskSeverity_1.RISK_SEVERITY.High,
            domainScores: [
                {
                    domain: "Security",
                    score: 72,
                    severity: RiskSeverity_1.RISK_SEVERITY.High,
                    impact: undefined,
                    likelihood: undefined
                }
            ],
            categoryScores: [
                {
                    category: "Security",
                    score: 72,
                    severity: RiskSeverity_1.RISK_SEVERITY.High
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
        const decision = RiskDecisionEngine_1.RiskDecisionEngine.generate(summary);
        expect(decision.score).toBe(72);
        expect(decision.level).toBe("High");
        expect(decision.approvalStatus).toBe("Rejected");
        expect(decision.heatMap).toHaveLength(1);
        expect(decision.heatMap[0].impact).toBe(0);
        expect(decision.heatMap[0].likelihood).toBe(0);
    });
});
