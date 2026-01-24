import type { ScoringPolicy } from "./ScoringPolicy.js";

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  severityWeights: {
    Low: 10,
    Moderate: 35,
    High: 70,
    Critical: 95
  },

  accumulation: {
    perFindingBoost: 15,
    maxBoost: 30
  },

  contextMultipliers: {
    regulated: 0.2,
    safetyCritical: 0.3,
    handlesPII: 0.2,
    scale: {
      Small: 0,
      Medium: 0.1,
      Enterprise: 0.2
    }
  },

  severityBands: {
    Low: 0,
    Moderate: 40,
    High: 65,
    Critical: 85
  }
};
