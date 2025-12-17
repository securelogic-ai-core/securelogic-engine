"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillableComplexityEngine = void 0;
class BillableComplexityEngine {
    static calculate(summary) {
        let score = 0;
        const rationale = [];
        // Severity weight
        switch (summary.severity) {
            case "Critical":
                score += 40;
                rationale.push("Critical enterprise severity");
                break;
            case "High":
                score += 30;
                rationale.push("High enterprise severity");
                break;
            case "Moderate":
                score += 15;
                rationale.push("Moderate enterprise severity");
                break;
            case "Low":
                score += 5;
                rationale.push("Low enterprise severity");
                break;
        }
        // Domain concentration
        score += summary.domainScores.length * 3;
        rationale.push(`${summary.domainScores.length} affected risk domains`);
        // Remediation effort
        score += summary.recommendedActions.length * 5;
        rationale.push(`${summary.recommendedActions.length} remediation actions`);
        // Governance premium
        const governance = summary.categoryScores.find(c => c.category === "Governance");
        if (governance && governance.score > 0) {
            score += 10;
            rationale.push("Governance risk present");
        }
        let pricingTier = "Standard";
        if (score >= 70)
            pricingTier = "Enterprise";
        else if (score >= 35)
            pricingTier = "Professional";
        return { complexityScore: score, pricingTier, rationale };
    }
}
exports.BillableComplexityEngine = BillableComplexityEngine;
