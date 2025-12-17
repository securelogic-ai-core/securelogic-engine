"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseSeverityPolicy = void 0;
class EnterpriseSeverityPolicy {
    static evaluate(summary) {
        const rationale = [];
        const policyTrace = [];
        let finalSeverity = summary.severity;
        const governance = summary.categoryScores.find(c => c.category === "Governance");
        if (governance && summary.overallScore > 0) {
            const share = governance.score / summary.overallScore;
            const triggered = share >= 0.3 && summary.overallScore >= 30;
            if (triggered) {
                finalSeverity = "High";
                rationale.push("Governance risk exceeds 30% of total enterprise risk", "Enterprise severity escalated due to governance materiality");
            }
            policyTrace.push({
                policyId: "ENT-GOV-001",
                description: "Governance materiality escalation",
                triggered,
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
        return { finalSeverity, rationale, policyTrace };
    }
}
exports.EnterpriseSeverityPolicy = EnterpriseSeverityPolicy;
