import fs from "fs";
import path from "path";

export function loadRiskConfig() {
  const configPath = path.join(__dirname, "../../config/riskMultipliers.json");

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("⚠️ Failed to load risk configuration. Using defaults.");
    return {
      multipliers: {
        missingPoliciesLikelihood: 0.1,
        missingPoliciesMax: 0.3,
        riskIndicatorsImpact: 0.2,
        riskIndicatorsMax: 0.4,
        foundControlsLikelihoodReduction: 0.05,
        foundControlsReductionMax: 0.2
      },
      version: "default"
    };
  }
}
