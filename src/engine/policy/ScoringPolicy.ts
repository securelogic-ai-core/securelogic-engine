import type { RiskLevel } from "../contracts/RiskLevel.js";

export type ScoringPolicy = {
  severityWeights: Record<RiskLevel, number>;

  accumulation: {
    perFindingBoost: number;
    maxBoost: number;
  };

  contextMultipliers: {
    regulated: number;
    safetyCritical: number;
    handlesPII: number;
    scale: {
      Small: number;
      Medium: number;
      Enterprise: number;
    };
  };

  severityBands: {
    Low: number;
    Moderate: number;
    High: number;
    Critical: number;
  };
};
