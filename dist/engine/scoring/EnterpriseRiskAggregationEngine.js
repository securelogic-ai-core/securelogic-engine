"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseRiskAggregationEngine = void 0;
const RiskSeverityEngine_1 = require("./RiskSeverityEngine");
const ControlRegistry_1 = require("../registry/ControlRegistry");
const DomainWeightPolicy_1 = require("../policy/DomainWeightPolicy");
class EnterpriseRiskAggregationEngine {
    static aggregate(scores) {
        const categoryTotals = {};
        const drivers = new Set();
        for (const score of scores) {
            const definition = Object.values(ControlRegistry_1.ControlRegistry.controls)
                .find(c => c.id === score.controlId);
            const category = definition?.domain ?? "Uncategorized";
            const weight = DomainWeightPolicy_1.DOMAIN_WEIGHTS[category] ?? 1.0;
            const weightedScore = score.totalRiskScore * weight;
            categoryTotals[category] =
                (categoryTotals[category] ?? 0) + weightedScore;
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
