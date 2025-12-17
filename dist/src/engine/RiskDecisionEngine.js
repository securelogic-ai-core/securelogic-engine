"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskDecisionEngine = void 0;
class RiskDecisionEngine {
    static generate(summary) {
        const score = summary.enterpriseRiskScore;
        const level = score >= 76 ? "Critical" :
            score >= 56 ? "High" :
                score >= 31 ? "Moderate" :
                    "Low";
        const approvalStatus = level === "Low"
            ? "Approved"
            : level === "Moderate"
                ? "Conditional"
                : "Rejected";
        const heatMap = summary.domainScores.map((d) => ({
            domain: d.domain,
            impact: d.impact ?? 0,
            likelihood: d.likelihood ?? 0
        }));
        const remediationPlan = summary.recommendedActions.map((a) => ({
            id: a.id,
            description: a.description,
            estimatedRiskReduction: a.estimatedRiskReduction,
            priority: a.priority
        }));
        return {
            score,
            level,
            dominantDomains: summary.topRiskDrivers,
            severityRationale: summary.severityRationale ?? [],
            heatMap,
            remediationPlan,
            approvalStatus
        };
    }
}
exports.RiskDecisionEngine = RiskDecisionEngine;
