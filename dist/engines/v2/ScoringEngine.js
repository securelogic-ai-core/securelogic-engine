"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringEngine = void 0;
class ScoringEngine {
    static score(controls, intake) {
        const scored = controls.map(c => {
            const impact = c.baselineImpact ?? 1;
            const likelihood = c.baselineLikelihood ?? 1;
            const risk = impact * likelihood;
            return {
                id: c.canonicalId,
                domain: c.canonicalDomain,
                title: c.canonicalTitle,
                impact,
                likelihood,
                risk
            };
        });
        const highestRisk = scored.length ? scored.reduce((a, b) => a.risk > b.risk ? a : b) : null;
        const averageRisk = scored.length ? scored.reduce((sum, x) => sum + x.risk, 0) / scored.length : 0;
        return { scored, highestRisk, averageRisk };
    }
}
exports.ScoringEngine = ScoringEngine;
