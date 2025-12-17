"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskHeatmapEngine = void 0;
class RiskHeatmapEngine {
    static generate(scores) {
        const cells = [];
        const impacts = ["Low", "Medium", "High"];
        const likelihoods = ["Low", "Medium", "High"];
        for (const impact of impacts) {
            for (const likelihood of likelihoods) {
                cells.push({
                    impact,
                    likelihood,
                    risks: []
                });
            }
        }
        for (const score of scores) {
            const impact = score.totalRiskScore >= 8 ? "High" :
                score.totalRiskScore >= 4 ? "Medium" : "Low";
            const likelihood = score.maturityPenalty >= 2 ? "High" :
                score.maturityPenalty === 1 ? "Medium" : "Low";
            const cell = cells.find(c => c.impact === impact && c.likelihood === likelihood);
            cell?.risks.push(score);
        }
        return cells;
    }
}
exports.RiskHeatmapEngine = RiskHeatmapEngine;
