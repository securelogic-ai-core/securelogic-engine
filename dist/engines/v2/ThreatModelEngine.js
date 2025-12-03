"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreatModelEngine = void 0;
/**
 * ThreatModelEngine (v2)
 *
 * Deterministic scenario generator.
 * No AI, no inference, no narrative drift.
 * Uses fixed templates based on impact/likelihood bands.
 */
class ThreatModelEngine {
    static build(scoring) {
        const items = scoring.scored.map(s => this.toThreatItem(s));
        return { items };
    }
    static toThreatItem(s) {
        return {
            controlId: s.controlId,
            title: s.title,
            scenario: this.mapScenario(s),
            severity: this.mapSeverity(s)
        };
    }
    static mapSeverity(s) {
        const risk = s.risk;
        if (risk >= 15)
            return 5;
        if (risk >= 10)
            return 4;
        if (risk >= 6)
            return 3;
        if (risk >= 3)
            return 2;
        return 1;
    }
    static mapScenario(s) {
        const impact = s.impact;
        const likelihood = s.likelihood;
        // Deterministic scenario categories
        if (impact >= 4 && likelihood >= 3)
            return `High-impact/high-likelihood failure of ${s.title} could cause major operational exposure.`;
        if (impact >= 4 && likelihood <= 2)
            return `High-impact but low-likelihood weakness in ${s.title} could lead to significant damage if triggered.`;
        if (impact <= 3 && likelihood >= 4)
            return `Moderate-impact but high-likelihood breakdown of ${s.title} may enable repeated exploitation.`;
        if (impact <= 2 && likelihood <= 2)
            return `Low-impact/low-likelihood deficiency in ${s.title} presents minimal immediate risk.`;
        // Default deterministic fallback
        return `Failure of ${s.title} may introduce operational or security risks based on its baseline scoring.`;
    }
}
exports.ThreatModelEngine = ThreatModelEngine;
