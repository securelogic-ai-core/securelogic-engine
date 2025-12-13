"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExceptionWeightingPolicy = void 0;
class ExceptionWeightingPolicy {
    static apply(scores) {
        return scores.map(score => {
            const state = score.evidence?.observedState;
            if (!state)
                return score;
            // Unmitigated + not accepted = exception
            if (state.implemented === false && state.riskAccepted === false) {
                const uplift = Math.max(score.totalRiskScore * 0.15, 1);
                return {
                    ...score,
                    totalRiskScore: Number((score.totalRiskScore + uplift).toFixed(2)),
                    drivers: [...score.drivers, "Unmitigated control exception"]
                };
            }
            return score;
        });
    }
}
exports.ExceptionWeightingPolicy = ExceptionWeightingPolicy;
