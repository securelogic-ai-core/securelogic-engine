"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillableComplexityEngine = void 0;
var BillableComplexityEngine = /** @class */ (function () {
    function BillableComplexityEngine() {
    }
    BillableComplexityEngine.calculate = function (summary) {
        var score = 0;
        var rationale = [];
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
        rationale.push("".concat(summary.domainScores.length, " affected risk domains"));
        // Remediation effort
        score += summary.recommendedActions.length * 5;
        rationale.push("".concat(summary.recommendedActions.length, " remediation actions"));
        // Governance premium
        var governance = summary.categoryScores.find(function (c) { return c.category === "Governance"; });
        if (governance && governance.score > 0) {
            score += 10;
            rationale.push("Governance risk present");
        }
        var pricingTier = "Standard";
        if (score >= 70)
            pricingTier = "Enterprise";
        else if (score >= 35)
            pricingTier = "Professional";
        return { complexityScore: score, pricingTier: pricingTier, rationale: rationale };
    };
    return BillableComplexityEngine;
}());
exports.BillableComplexityEngine = BillableComplexityEngine;
