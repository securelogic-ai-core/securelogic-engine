"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanonicalizationEngine = void 0;
class CanonicalizationEngine {
    static canonicalize(controls) {
        return controls.map(c => ({
            canonicalId: c.id,
            canonicalDomain: c.domain ?? "General",
            canonicalTitle: c.title,
            canonicalDescription: c.description,
            canonicalKeywords: c.keywords ?? [],
            baselineImpact: c.baselineImpact ?? 1,
            baselineLikelihood: c.baselineLikelihood ?? 1
        }));
    }
}
exports.CanonicalizationEngine = CanonicalizationEngine;
