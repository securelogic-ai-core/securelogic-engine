"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseRiskAggregationEngine = void 0;
const RiskSeverityEngine_1 = require("./RiskSeverityEngine");
class EnterpriseRiskAggregationEngine {
    static aggregate(scores) {
        const categoryTotals = {};
        const drivers = new Set();
        for (const score of scores) {
            categoryTotals[score.controlId] =
                (categoryTotals[score.controlId] ?? 0) + score.totalRiskScore;
            score.drivers.forEach(d => drivers.add(d));
        }
        const overallScore = Object.values(categoryTotals)
            .reduce((a, b) => a + b, 0);
        return {
            overallScore,
            severity: RiskSeverityEngine_1.RiskSeverityEngine.fromScore(overallScore),
            categoryScores: Object.entries(categoryTotals).map(([category, score]) => ({
                category,
                score,
                severity: RiskSeverityEngine_1.RiskSeverityEngine.fromScore(score)
            })),
            topRiskDrivers: Array.from(drivers).slice(0, 5)
        };
    }
}
exports.EnterpriseRiskAggregationEngine = EnterpriseRiskAggregationEngine;
