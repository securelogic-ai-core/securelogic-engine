"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseSeverityPolicy = void 0;
var EnterpriseSeverityPolicy = /** @class */ (function () {
    function EnterpriseSeverityPolicy() {
    }
    EnterpriseSeverityPolicy.evaluate = function (summary) {
        var rationale = [];
        var policyTrace = [];
        var finalSeverity = summary.severity;
        var governance = summary.categoryScores.find(function (c) { return c.category === "Governance"; });
        if (governance && summary.overallScore > 0) {
            var share = governance.score / summary.overallScore;
            var triggered = share >= 0.3 && summary.overallScore >= 30;
            if (triggered) {
                finalSeverity = "High";
                rationale.push("Governance risk exceeds 30% of total enterprise risk", "Enterprise severity escalated due to governance materiality");
            }
            policyTrace.push({
                policyId: "ENT-GOV-001",
                description: "Governance materiality escalation",
                triggered: triggered,
                inputs: {
                    governanceShare: share,
                    governanceScore: governance.score,
                    overallScore: summary.overallScore
                },
                outcome: triggered
                    ? "Severity escalated to High"
                    : "No escalation"
            });
        }
        else {
            policyTrace.push({
                policyId: "ENT-GOV-001",
                description: "Governance materiality escalation",
                triggered: false,
                inputs: {
                    governancePresent: Boolean(governance),
                    overallScore: summary.overallScore
                },
                outcome: "Insufficient inputs to evaluate"
            });
        }
        return { finalSeverity: finalSeverity, rationale: rationale, policyTrace: policyTrace };
    };
    return EnterpriseSeverityPolicy;
}());
exports.EnterpriseSeverityPolicy = EnterpriseSeverityPolicy;
