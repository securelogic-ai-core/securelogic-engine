"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyIngestionSignals = applyIngestionSignals;
const loadRiskConfig_1 = require("../config/loadRiskConfig");
function applyIngestionSignals(baseScore, signals) {
    const { multipliers } = (0, loadRiskConfig_1.loadRiskConfig)();
    let { likelihood, impact } = baseScore;
    // Missing Policies → Likelihood ↑
    if (signals?.missingPolicies?.length) {
        const bump = Math.min(signals.missingPolicies.length * multipliers.missingPoliciesLikelihood, multipliers.missingPoliciesMax);
        likelihood += bump;
    }
    // Risk Indicators → Impact ↑
    if (signals?.riskIndicators?.length) {
        const bump = Math.min(signals.riskIndicators.length * multipliers.riskIndicatorsImpact, multipliers.riskIndicatorsMax);
        impact += bump;
    }
    // Found Controls → Likelihood ↓
    if (signals?.foundControls?.length) {
        const reduction = Math.min(signals.foundControls.length * multipliers.foundControlsLikelihoodReduction, multipliers.foundControlsReductionMax);
        likelihood -= reduction;
    }
    // Clamp values
    likelihood = Math.max(0, Math.min(1, likelihood));
    impact = Math.max(0, Math.min(1, impact));
    return { likelihood, impact };
}
