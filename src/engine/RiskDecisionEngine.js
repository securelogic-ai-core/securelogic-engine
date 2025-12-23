"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskDecisionEngine = void 0;
var RiskDecisionEngine = /** @class */ (function () {
    function RiskDecisionEngine() {
    }
    RiskDecisionEngine.generate = function (summary) {
        var _a;
        var score = summary.enterpriseRiskScore;
        var level = score >= 76 ? "Critical" :
            score >= 56 ? "High" :
                score >= 31 ? "Moderate" :
                    "Low";
        var approvalStatus = level === "Low"
            ? "Approved"
            : level === "Moderate"
                ? "Conditional"
                : "Rejected";
        var heatMap = summary.domainScores.map(function (d) {
            var _a, _b;
            return ({
                domain: d.domain,
                impact: (_a = d.impact) !== null && _a !== void 0 ? _a : 0,
                likelihood: (_b = d.likelihood) !== null && _b !== void 0 ? _b : 0
            });
        });
        var remediationPlan = summary.recommendedActions.map(function (a) { return ({
            id: a.id,
            description: a.description,
            estimatedRiskReduction: a.estimatedRiskReduction,
            priority: a.priority
        }); });
        return {
            score: score,
            level: level,
            dominantDomains: summary.topRiskDrivers,
            severityRationale: (_a = summary.severityRationale) !== null && _a !== void 0 ? _a : [],
            heatMap: heatMap,
            remediationPlan: remediationPlan,
            approvalStatus: approvalStatus
        };
    };
    return RiskDecisionEngine;
}());
exports.RiskDecisionEngine = RiskDecisionEngine;
