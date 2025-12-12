"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskNarrativeEngine = void 0;
class RiskNarrativeEngine {
    static generate(score, signals) {
        const narrative = [];
        if (signals?.missingPolicies?.length) {
            narrative.push("Likelihood increased due to missing policies: " +
                signals.missingPolicies.join(", ") +
                ".");
        }
        if (signals?.riskIndicators?.length) {
            narrative.push("Impact increased due to risk indicators: " +
                signals.riskIndicators.join(", ") +
                ".");
        }
        if (signals?.foundControls?.length) {
            narrative.push("Likelihood decreased due to implemented controls: " +
                signals.foundControls.join(", ") +
                ".");
        }
        if (narrative.length === 0) {
            narrative.push("No ingestion-based risk adjustments were detected.");
        }
        return narrative;
    }
}
exports.RiskNarrativeEngine = RiskNarrativeEngine;
