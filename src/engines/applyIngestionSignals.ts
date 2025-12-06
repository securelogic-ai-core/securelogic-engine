import { loadRiskConfig } from "../config/loadRiskConfig";

export function applyIngestionSignals(
  baseScore: { likelihood: number; impact: number },
  signals: any
) {
  const { multipliers } = loadRiskConfig();

  let { likelihood, impact } = baseScore;

  // Missing Policies → Likelihood ↑
  if (signals?.missingPolicies?.length) {
    const bump = Math.min(
      signals.missingPolicies.length * multipliers.missingPoliciesLikelihood,
      multipliers.missingPoliciesMax
    );
    likelihood += bump;
  }

  // Risk Indicators → Impact ↑
  if (signals?.riskIndicators?.length) {
    const bump = Math.min(
      signals.riskIndicators.length * multipliers.riskIndicatorsImpact,
      multipliers.riskIndicatorsMax
    );
    impact += bump;
  }

  // Found Controls → Likelihood ↓
  if (signals?.foundControls?.length) {
    const reduction = Math.min(
      signals.foundControls.length * multipliers.foundControlsLikelihoodReduction,
      multipliers.foundControlsReductionMax
    );
    likelihood -= reduction;
  }

  // Clamp values
  likelihood = Math.max(0, Math.min(1, likelihood));
  impact = Math.max(0, Math.min(1, impact));

  return { likelihood, impact };
}
