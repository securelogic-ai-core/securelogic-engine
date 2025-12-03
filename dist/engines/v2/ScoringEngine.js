"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringEngine = void 0;
/**
 * ScoringEngine (v2)
 *
 * Applies deterministic scoring based purely on canonical values.
 * No mutations. No assumptions. Score = impact × likelihood.
 */
class ScoringEngine {
    static score(groups) {
        const scored = [];
        for (const group of groups) {
            for (const control of group.controls) {
                const impact = control.baselineImpact ?? 1;
                const likelihood = control.baselineLikelihood ?? 1;
                scored.push({
                    controlId: control.canonicalId,
                    title: control.canonicalTitle,
                    domain: group.domain,
                    impact,
                    likelihood,
                    risk: impact * likelihood,
                    score: impact * likelihood,
                });
            }
        }
        const highestRisk = scored.length > 0
            ? Math.max(...scored.map(s => s.risk))
            : 0;
        const averageRisk = scored.length > 0
            ? scored.reduce((sum, s) => sum + s.risk, 0) / scored.length
            : 0;
        return {
            scored,
            highestRisk,
            averageRisk
        };
    }
}
exports.ScoringEngine = ScoringEngine;
