"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseRiskAggregationEngine = void 0;
const RiskSeverityEngine_1 = require("./RiskSeverityEngine");
const ControlRegistry_1 = require("../registry/ControlRegistry");
const DomainWeightPolicy_1 = require("../policy/DomainWeightPolicy");
class EnterpriseRiskAggregationEngine {
    static aggregate(scores) {
        const categoryTotals = {};
        const domainScores = [];
        const drivers = new Set();
        for (const score of scores) {
            const definition = Object.values(ControlRegistry_1.ControlRegistry.controls).find(c => c.id === score.controlId);
            const domain = definition?.domain ?? "Uncategorized";
            const weight = DomainWeightPolicy_1.DOMAIN_WEIGHTS[domain] ?? 1.0;
            const weightedScore = score.totalRiskScore * weight;
            categoryTotals[domain] =
                (categoryTotals[domain] ?? 0) + weightedScore;
            score.drivers.forEach((d) => drivers.add(d));
            domainScores.push({
                domain,
                score: weightedScore,
                severity: RiskSeverityEngine_1.RiskSeverityEngine.fromScore(weightedScore)
            });
        }
        const overallScore = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
        const categoryScores = Object.entries(categoryTotals).map(([category, score]) => ({
            category,
            score,
            severity: RiskSeverityEngine_1.RiskSeverityEngine.fromScore(score)
        }));
        const severity = RiskSeverityEngine_1.RiskSeverityEngine.fromScore(overallScore);
        const recommendedActions = [];
        return {
            overallScore,
            enterpriseRiskScore: overallScore,
            severity,
            domainScores,
            categoryScores,
            topRiskDrivers: Array.from(drivers).slice(0, 5),
            severityRationale: [],
            recommendedActions
        };
    }
}
exports.EnterpriseRiskAggregationEngine = EnterpriseRiskAggregationEngine;
