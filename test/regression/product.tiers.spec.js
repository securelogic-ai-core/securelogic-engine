"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var SecureLogicAI_1 = require("../../src/product/SecureLogicAI");
var baseSummary = {
    enterpriseRiskScore: 80,
    overallScore: 80,
    severity: "High",
    topRiskDrivers: ["Governance"],
    severityRationale: ["High residual risk"],
    domainScores: [],
    categoryScores: [],
    recommendedActions: []
};
describe("Product tier enforcement", function () {
    it("Starter receives decision only", function () {
        var result = SecureLogicAI_1.SecureLogicAI.runAssessment(baseSummary, { tier: "Starter" });
        expect(result).toMatchSnapshot();
    });
    it("Professional excludes pricing", function () {
        var result = SecureLogicAI_1.SecureLogicAI.runAssessment(baseSummary, { tier: "Professional" });
        expect(result).toMatchSnapshot();
    });
    it("Enterprise includes full report", function () {
        var result = SecureLogicAI_1.SecureLogicAI.runAssessment(baseSummary, { tier: "Enterprise" });
        expect(result).toMatchSnapshot();
    });
});
