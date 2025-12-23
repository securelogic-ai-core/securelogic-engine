"use strict";
/**
 * INTERNAL scoring result builder.
 * Not a public contract.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScoringResult = buildScoringResult;
function buildScoringResult(score, domains) {
    return {
        score: score,
        domains: domains
    };
}
