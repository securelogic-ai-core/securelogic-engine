"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SecureLogicAI_1 = require("../../src/product/SecureLogicAI");
const baseSummary = {
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
        const result = SecureLogicAI_1.SecureLogicAI.runAssessment(baseSummary, { tier: "Starter" });
        expect(result).toMatchSnapshot();
    });
    it("Professional excludes pricing", () => {
        const result = SecureLogicAI_1.SecureLogicAI.runAssessment(baseSummary, { tier: "Professional" });
        expect(result).toMatchSnapshot();
    });
    it("Enterprise includes full report", () => {
        const result = SecureLogicAI_1.SecureLogicAI.runAssessment(baseSummary, { tier: "Enterprise" });
        expect(result).toMatchSnapshot();
    });
});
